import type { JWTVerifyGetKey } from 'jose';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import { isSingleFactorAcr, type TKerbwellSignerAssertionClaims, ZKerbwellSignerAssertionClaimsSchema } from './claims';
import {
  KERBWELL_GATE_ASSERTION_MAX_LIFETIME_SECONDS,
  KERBWELL_GATE_CLOCK_TOLERANCE_SECONDS,
  type KerbwellGateConfig,
} from './config';

export type KerbwellAssertionRefusal =
  | 'malformed'
  | 'signature'
  | 'expired'
  | 'issuer'
  | 'audience'
  | 'claims'
  | 'lifetime'
  | 'single_factor_agency';

export class KerbwellAssertionError extends Error {
  constructor(
    readonly reason: KerbwellAssertionRefusal,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'KerbwellAssertionError';
  }
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

/**
 * The issuer's key set, fetched from the pinned JWKS URL and cached (jose refetches on an unknown
 * kid, at most every 30 seconds, and every 10 minutes otherwise).
 */
const getIssuerKeySet = (jwksUrl: string): JWTVerifyGetKey => {
  let keySet = jwksCache.get(jwksUrl);

  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(jwksUrl), {
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
      timeoutDuration: 5_000,
    });

    jwksCache.set(jwksUrl, keySet);
  }

  return keySet;
};

type VerifyKerbwellAssertionOptions = {
  assertion: string;
  config: KerbwellGateConfig;
  /** Tests pass a local key set; production always uses the issuer's JWKS. */
  keySet?: JWTVerifyGetKey;
  now?: Date;
};

/**
 * Verifies a signer assertion: ES256 only, signed by a key in the issuer's JWKS, iss equal to the
 * configured issuer, aud containing the configured audience, unexpired, not issued for longer
 * than five minutes, with every claim the gate needs. Throws KerbwellAssertionError.
 *
 * Does not check the recipient, the envelope or the jti; the gate route does those against the
 * database.
 */
export const verifyKerbwellAssertion = async ({
  assertion,
  config,
  keySet,
  now = new Date(),
}: VerifyKerbwellAssertionOptions): Promise<TKerbwellSignerAssertionClaims> => {
  if (typeof assertion !== 'string' || assertion.length > 16_384 || assertion.split('.').length !== 3) {
    throw new KerbwellAssertionError('malformed');
  }

  let payload: Record<string, unknown>;

  try {
    const result = await jwtVerify(assertion, keySet ?? getIssuerKeySet(config.jwksUrl), {
      algorithms: ['ES256'],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ['exp', 'iat', 'jti', 'sub', 'auth_time'],
      clockTolerance: KERBWELL_GATE_CLOCK_TOLERANCE_SECONDS,
      currentDate: now,
    });

    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new KerbwellAssertionError('expired');
    }

    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      if (err.claim === 'iss') {
        throw new KerbwellAssertionError('issuer');
      }

      if (err.claim === 'aud') {
        throw new KerbwellAssertionError('audience');
      }

      throw new KerbwellAssertionError('claims', `claim ${err.claim}`);
    }

    if (err instanceof joseErrors.JWSSignatureVerificationFailed || err instanceof joseErrors.JWKSNoMatchingKey) {
      throw new KerbwellAssertionError('signature');
    }

    if (err instanceof joseErrors.JOSEAlgNotAllowed) {
      throw new KerbwellAssertionError('signature', 'algorithm');
    }

    throw new KerbwellAssertionError('malformed');
  }

  const parsed = ZKerbwellSignerAssertionClaimsSchema.safeParse(payload);

  if (!parsed.success) {
    throw new KerbwellAssertionError('claims', parsed.error.issues.map((i) => i.path.join('.')).join(','));
  }

  const claims = parsed.data;
  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (claims.exp - claims.iat > KERBWELL_GATE_ASSERTION_MAX_LIFETIME_SECONDS) {
    throw new KerbwellAssertionError('lifetime');
  }

  if (claims.iat > nowSeconds + KERBWELL_GATE_CLOCK_TOLERANCE_SECONDS) {
    throw new KerbwellAssertionError('lifetime', 'issued in the future');
  }

  if (claims.auth_time > nowSeconds + KERBWELL_GATE_CLOCK_TOLERANCE_SECONDS || claims.auth_time > claims.exp) {
    throw new KerbwellAssertionError('claims', 'auth_time');
  }

  // Defence in depth: Kerbwell Identity never issues a single-channel verification for an agency
  // agreement, and the gate refuses one if it ever arrives.
  if (isSingleFactorAcr(claims.acr) && claims.doc_kind === 'agency_agreement') {
    throw new KerbwellAssertionError('single_factor_agency');
  }

  return claims;
};
