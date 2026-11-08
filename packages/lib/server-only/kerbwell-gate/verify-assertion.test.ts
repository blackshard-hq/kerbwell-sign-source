import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { getKerbwellGateConfig, type KerbwellGateConfig } from './config';
import { KerbwellAssertionError, verifyKerbwellAssertion } from './verify-assertion';

const ISSUER = 'https://auth.kerbwell.com.au';
const NOW = new Date('2026-11-04T01:00:00Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

const config = getKerbwellGateConfig({ NEXT_PRIVATE_KERBWELL_GATE_ISSUER: ISSUER }) as KerbwellGateConfig;

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

const baseClaims = () => ({
  sub: '42',
  env: 'envelope_abc123',
  jti: 'jti_0123456789abcdef',
  auth_time: NOW_S - 30,
  acr: 'kw-sign-l1',
  amr: ['otp_sms'],
  consent_version: 'au-eta-2026-11-pending-legal',
  consent_hash: 'a'.repeat(64),
  idv_ref: null,
  legal_name: 'Jordan Example Citizen',
  doc_kind: 'agency_agreement',
  ip: '203.0.113.7',
  ua: 'Mozilla/5.0 (iPhone)',
  cf_city: 'Brisbane',
});

const mint = async (
  claims: Record<string, unknown> = baseClaims(),
  { key = privateKey, iss = ISSUER, aud = 'sign', iat = NOW_S, exp = NOW_S + 120, alg = 'ES256' } = {},
) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg, kid: 'k1' })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key);

const verify = (assertion: string) => verifyKerbwellAssertion({ assertion, config, keySet: jwks, now: NOW });

const expectRefusal = async (promise: Promise<unknown>, reason: string) => {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(KerbwellAssertionError);
  expect((err as KerbwellAssertionError).reason).toBe(reason);
};

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

describe('verifyKerbwellAssertion', () => {
  it('accepts a well-formed ES256 assertion from the issuer and returns every claim', async () => {
    const claims = await verify(await mint());
    expect(claims).toMatchObject({
      sub: '42',
      env: 'envelope_abc123',
      acr: 'kw-sign-l1',
      amr: ['otp_sms'],
      legal_name: 'Jordan Example Citizen',
      doc_kind: 'agency_agreement',
      ip: '203.0.113.7',
      cf_city: 'Brisbane',
    });
  });

  it('refuses an expired assertion', async () => {
    await expectRefusal(verify(await mint(baseClaims(), { iat: NOW_S - 300, exp: NOW_S - 120 })), 'expired');
  });

  it('refuses another audience and another issuer', async () => {
    await expectRefusal(verify(await mint(baseClaims(), { aud: 'portal' })), 'audience');
    await expectRefusal(verify(await mint(baseClaims(), { iss: 'https://evil.example' })), 'issuer');
  });

  it('refuses a token signed by a key outside the issuer JWKS', async () => {
    await expectRefusal(verify(await mint(baseClaims(), { key: otherKey })), 'signature');
  });

  it('refuses an HS256 token even when its secret is the public key material', async () => {
    const hs = await new SignJWT(baseClaims())
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience('sign')
      .setIssuedAt(NOW_S)
      .setExpirationTime(NOW_S + 60)
      .sign(new TextEncoder().encode('x'.repeat(32)));
    const err = await verify(hs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KerbwellAssertionError);
  });

  it('refuses an assertion issued for longer than five minutes', async () => {
    await expectRefusal(verify(await mint(baseClaims(), { exp: NOW_S + 3600 })), 'lifetime');
  });

  it('refuses a single-factor verification for an agency agreement', async () => {
    await expectRefusal(verify(await mint({ ...baseClaims(), acr: 'kw-sign-l1-single' })), 'single_factor_agency');
  });

  it('accepts a single-factor verification for a general document', async () => {
    const claims = await verify(
      await mint({ ...baseClaims(), acr: 'kw-sign-l1-single', doc_kind: 'general_non_prescribed' }),
    );
    expect(claims.acr).toBe('kw-sign-l1-single');
  });

  it('refuses missing or malformed claims', async () => {
    const { legal_name: _ln, ...noName } = baseClaims();
    await expectRefusal(verify(await mint(noName)), 'claims');
    await expectRefusal(verify(await mint({ ...baseClaims(), sub: 'abc' })), 'claims');
    await expectRefusal(verify(await mint({ ...baseClaims(), acr: 'kw-sign-l9' })), 'claims');
    await expectRefusal(verify(await mint({ ...baseClaims(), consent_hash: 'nothex' })), 'claims');
    await expectRefusal(verify('not.a.jwt'), 'malformed');
  });

  it('refuses an auth_time in the future', async () => {
    await expectRefusal(verify(await mint({ ...baseClaims(), auth_time: NOW_S + 600 })), 'claims');
  });
});

describe('getKerbwellGateConfig', () => {
  it('is off without an issuer and with mode off', () => {
    expect(getKerbwellGateConfig({})).toBeNull();
    expect(
      getKerbwellGateConfig({ NEXT_PRIVATE_KERBWELL_GATE_ISSUER: ISSUER, NEXT_PRIVATE_KERBWELL_GATE_MODE: 'off' }),
    ).toBeNull();
  });

  it('defaults to mode all, aud sign, the issuer JWKS and 15 minutes', () => {
    expect(config).toEqual({
      issuer: ISSUER,
      jwksUrl: `${ISSUER}/jwks`,
      audience: 'sign',
      mode: 'all',
      reauthUrl: `${ISSUER}/signer`,
      maxAuthAgeSeconds: 900,
      actionsUrl: null,
      passkeyUrl: `${ISSUER}/signer/passkey`,
    });
  });

  it('pins the JWKS and the re-auth URL to the issuer origin', () => {
    expect(() =>
      getKerbwellGateConfig({
        NEXT_PRIVATE_KERBWELL_GATE_ISSUER: ISSUER,
        NEXT_PRIVATE_KERBWELL_GATE_JWKS_URL: 'https://keys.example/jwks',
      }),
    ).toThrow(/issuer origin/);
    expect(() =>
      getKerbwellGateConfig({
        NEXT_PRIVATE_KERBWELL_GATE_ISSUER: ISSUER,
        NEXT_PRIVATE_KERBWELL_GATE_REAUTH_URL: 'https://elsewhere.example/signer',
      }),
    ).toThrow(/issuer origin/);
  });

  it('refuses plain http except on loopback', () => {
    expect(() => getKerbwellGateConfig({ NEXT_PRIVATE_KERBWELL_GATE_ISSUER: 'http://auth.kerbwell.com.au' })).toThrow(
      /https/,
    );
    expect(getKerbwellGateConfig({ NEXT_PRIVATE_KERBWELL_GATE_ISSUER: 'http://127.0.0.1:4455' })?.issuer).toBe(
      'http://127.0.0.1:4455',
    );
  });

  it('never lets the re-auth window grow past 15 minutes', () => {
    expect(() =>
      getKerbwellGateConfig({
        NEXT_PRIVATE_KERBWELL_GATE_ISSUER: ISSUER,
        NEXT_PRIVATE_KERBWELL_GATE_MAX_AUTH_AGE: '3600',
      }),
    ).toThrow();
  });
});
