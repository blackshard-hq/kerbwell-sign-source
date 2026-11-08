import type { JWTVerifyGetKey } from 'jose';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Kerbwell Sign admin sign-in (fork addition). With NEXT_PUBLIC_KERBWELL_ADMIN_OIDC_ONLY='true' the
 * only way into the admin UI is OIDC against Kerbwell Identity, and the callback accepts the id_token
 * only when:
 *
 * - its signature verifies against the provider's JWKS (jwks_uri from discovery), ES256 or RS256,
 *   with iss equal to the discovered issuer and aud containing our client id;
 * - its roles claim (NEXT_PRIVATE_KERBWELL_ADMIN_ROLES_CLAIM, default `roles`) holds the admin role
 *   (NEXT_PRIVATE_KERBWELL_ADMIN_ROLE, default `kerbwell-sign-admin`);
 * - its amr holds a passkey method (NEXT_PRIVATE_KERBWELL_ADMIN_AMR, comma-separated, default
 *   `passkey,webauthn,hwk,swk`; RFC 8176 hwk/swk are proof of a hardware or software key).
 */
export type KerbwellAdminOidcRefusal = 'token' | 'role' | 'amr';

export class KerbwellAdminOidcError extends Error {
  constructor(readonly reason: KerbwellAdminOidcRefusal) {
    super(reason);
    this.name = 'KerbwellAdminOidcError';
  }
}

export const getKerbwellAdminOidcPolicy = (env: NodeJS.ProcessEnv = process.env) => ({
  role: env.NEXT_PRIVATE_KERBWELL_ADMIN_ROLE?.trim() || 'kerbwell-sign-admin',
  rolesClaim: env.NEXT_PRIVATE_KERBWELL_ADMIN_ROLES_CLAIM?.trim() || 'roles',
  amr: (env.NEXT_PRIVATE_KERBWELL_ADMIN_AMR?.trim() || 'passkey,webauthn,hwk,swk')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
});

/** Checks the role and amr claims of an already verified id_token payload. */
export const assertKerbwellAdminClaims = (
  claims: Record<string, unknown>,
  policy = getKerbwellAdminOidcPolicy(),
): void => {
  const rawRoles = claims[policy.rolesClaim];
  const roles = Array.isArray(rawRoles) ? rawRoles : typeof rawRoles === 'string' ? rawRoles.split(/\s+/) : [];

  if (!roles.includes(policy.role)) {
    throw new KerbwellAdminOidcError('role');
  }

  const amr = Array.isArray(claims.amr) ? claims.amr : [];

  if (!amr.some((method) => typeof method === 'string' && policy.amr.includes(method))) {
    throw new KerbwellAdminOidcError('amr');
  }
};

const jwksCache = new Map<string, JWTVerifyGetKey>();

/**
 * Verifies the id_token from the token endpoint and applies the admin policy. Returns the payload.
 */
export const verifyKerbwellAdminIdToken = async ({
  idToken,
  issuer,
  jwksUri,
  clientId,
  keySet,
}: {
  idToken: string;
  issuer: string | undefined;
  jwksUri: string | undefined;
  clientId: string;
  keySet?: JWTVerifyGetKey;
}): Promise<Record<string, unknown>> => {
  if (!issuer || (!jwksUri && !keySet)) {
    throw new KerbwellAdminOidcError('token');
  }

  let keys = keySet;

  if (!keys && jwksUri) {
    keys = jwksCache.get(jwksUri);

    if (!keys) {
      keys = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 5_000 });
      jwksCache.set(jwksUri, keys);
    }
  }

  let payload: Record<string, unknown>;

  try {
    // biome-ignore lint/style/noNonNullAssertion: set above
    const result = await jwtVerify(idToken, keys!, {
      algorithms: ['ES256', 'RS256'],
      issuer,
      audience: clientId,
      clockTolerance: 30,
    });

    payload = result.payload;
  } catch {
    throw new KerbwellAdminOidcError('token');
  }

  assertKerbwellAdminClaims(payload);

  return payload;
};
