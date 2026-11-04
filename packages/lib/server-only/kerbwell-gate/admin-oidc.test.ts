import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { assertKerbwellAdminClaims, KerbwellAdminOidcError, verifyKerbwellAdminIdToken } from './admin-oidc';

const policy = { role: 'kerbwell-sign-admin', rolesClaim: 'roles', amr: ['passkey', 'webauthn', 'hwk', 'swk'] };

const reasonOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof KerbwellAdminOidcError ? e.reason : 'other';
  }
};

describe('Kerbwell Sign admin OIDC policy', () => {
  it('accepts the admin role with a passkey amr', () => {
    expect(
      reasonOf(() => assertKerbwellAdminClaims({ roles: ['kerbwell-sign-admin'], amr: ['hwk', 'user'] }, policy)),
    ).toBeNull();
  });

  it('refuses a sign-in without a passkey amr', () => {
    expect(
      reasonOf(() => assertKerbwellAdminClaims({ roles: ['kerbwell-sign-admin'], amr: ['pwd', 'otp'] }, policy)),
    ).toBe('amr');
    expect(reasonOf(() => assertKerbwellAdminClaims({ roles: ['kerbwell-sign-admin'] }, policy))).toBe('amr');
  });

  it('refuses an account without the admin role', () => {
    expect(reasonOf(() => assertKerbwellAdminClaims({ roles: ['staff'], amr: ['passkey'] }, policy))).toBe('role');
    expect(reasonOf(() => assertKerbwellAdminClaims({ amr: ['passkey'] }, policy))).toBe('role');
  });

  it('verifies the id_token signature, issuer and audience before the claims', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const keySet = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'a', alg: 'ES256' }] });
    const mint = (claims: Record<string, unknown>, aud = 'kerbwell-sign') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'a' })
        .setIssuer('https://auth.kerbwell.com.au')
        .setAudience(aud)
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(privateKey);

    const ok = await verifyKerbwellAdminIdToken({
      idToken: await mint({ sub: 'u1', roles: ['kerbwell-sign-admin'], amr: ['passkey'] }),
      issuer: 'https://auth.kerbwell.com.au',
      jwksUri: undefined,
      clientId: 'kerbwell-sign',
      keySet,
    });
    expect(ok.sub).toBe('u1');

    await expect(
      verifyKerbwellAdminIdToken({
        idToken: await mint({ sub: 'u1', roles: ['kerbwell-sign-admin'], amr: ['passkey'] }, 'someone-else'),
        issuer: 'https://auth.kerbwell.com.au',
        jwksUri: undefined,
        clientId: 'kerbwell-sign',
        keySet,
      }),
    ).rejects.toMatchObject({ reason: 'token' });

    await expect(
      verifyKerbwellAdminIdToken({
        idToken: await mint({ sub: 'u1', roles: ['kerbwell-sign-admin'], amr: ['pwd'] }),
        issuer: 'https://auth.kerbwell.com.au',
        jwksUri: undefined,
        clientId: 'kerbwell-sign',
        keySet,
      }),
    ).rejects.toMatchObject({ reason: 'amr' });
  });
});
