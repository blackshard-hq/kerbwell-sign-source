/**
 * Kerbwell gate configuration (fork addition, Kerbwell Sign).
 *
 * A recipient opens and signs only after Kerbwell Identity has verified them and posted a signer
 * assertion to /api/kerbwell/gate. The assertion is an ES256 JWT signed by the identity service;
 * the fork checks it against that issuer's JWKS and nothing else.
 *
 * NEXT_PRIVATE_KERBWELL_GATE_ISSUER        the identity service origin, e.g. https://auth.kerbwell.com.au.
 *                                          Unset turns the gate off (upstream behaviour).
 * NEXT_PRIVATE_KERBWELL_GATE_JWKS_URL      the JWKS URL. Default `<issuer>/jwks`. Must be on the
 *                                          issuer's origin: the key set is pinned to that issuer.
 * NEXT_PRIVATE_KERBWELL_GATE_AUDIENCE      the `aud` the assertion must carry. Default `sign`.
 * NEXT_PRIVATE_KERBWELL_GATE_MODE          `all` (default when the issuer is set): every recipient
 *                                          needs the gate. `recipient`: only recipients whose access
 *                                          or action auth includes KERBWELL_GATE. `off`: none.
 * NEXT_PRIVATE_KERBWELL_GATE_REAUTH_URL    where Complete sends a signer whose verification is too
 *                                          old. Default `<issuer>/signer`.
 * NEXT_PRIVATE_KERBWELL_GATE_MAX_AUTH_AGE  seconds an identity verification stays good for Complete.
 *                                          Default 900 (15 minutes).
 * NEXT_PRIVATE_KERBWELL_GATE_ACTIONS_URL   the portal page behind the signing page's "Something wrong?"
 *                                          panel, e.g. https://vendor.kerbwell.com.au/s/actions. The
 *                                          fork links to it with action (ask, decline, wrong-person or
 *                                          paper), recipient and envelope. Unset: Ask the agent mails
 *                                          the agent and the other three open the fork's own decline.
 * NEXT_PRIVATE_KERBWELL_GATE_PASSKEY_URL   the passkey offer the done page links to (not in kiosk
 *                                          mode). Default `<issuer>/signer/passkey`, on the issuer origin.
 *
 * An `http:` issuer is accepted only on a loopback host (the CI image tests); anything else must
 * be https.
 */
export const KERBWELL_GATE_COOKIE_NAME = '__Host-kw_gate';

/** The gate cookie, and the session behind it, live 30 minutes from the verification. */
export const KERBWELL_GATE_SESSION_TTL_SECONDS = 30 * 60;

/** The longest an assertion may claim to be valid for (exp - iat). Kerbwell Identity mints 2 minutes. */
export const KERBWELL_GATE_ASSERTION_MAX_LIFETIME_SECONDS = 5 * 60;

export const KERBWELL_GATE_CLOCK_TOLERANCE_SECONDS = 30;

export type KerbwellGateMode = 'all' | 'recipient' | 'off';

export type KerbwellGateConfig = {
  issuer: string;
  jwksUrl: string;
  audience: string;
  mode: KerbwellGateMode;
  reauthUrl: string;
  maxAuthAgeSeconds: number;
  actionsUrl: string | null;
  passkeyUrl: string;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const parseOrigin = (raw: string, name: string): URL => {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a URL`);
  }

  const isLoopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

  if (url.protocol !== 'https:' && !isLoopbackHttp) {
    throw new Error(`${name} must be https`);
  }

  return url;
};

/**
 * Reads the gate configuration from the environment. Returns null when the gate is off.
 * Throws on a configuration that is set but unsafe, so a bad value stops the request rather
 * than letting a recipient through.
 */
export const getKerbwellGateConfig = (env: NodeJS.ProcessEnv = process.env): KerbwellGateConfig | null => {
  const rawIssuer = env.NEXT_PRIVATE_KERBWELL_GATE_ISSUER?.trim();

  if (!rawIssuer) {
    return null;
  }

  const rawMode = env.NEXT_PRIVATE_KERBWELL_GATE_MODE?.trim() || 'all';

  if (rawMode !== 'all' && rawMode !== 'recipient' && rawMode !== 'off') {
    throw new Error('NEXT_PRIVATE_KERBWELL_GATE_MODE must be all, recipient or off');
  }

  if (rawMode === 'off') {
    return null;
  }

  const issuerUrl = parseOrigin(rawIssuer, 'NEXT_PRIVATE_KERBWELL_GATE_ISSUER');
  const issuer = rawIssuer.replace(/\/+$/, '');

  const jwksUrl = env.NEXT_PRIVATE_KERBWELL_GATE_JWKS_URL?.trim() || `${issuer}/jwks`;

  if (parseOrigin(jwksUrl, 'NEXT_PRIVATE_KERBWELL_GATE_JWKS_URL').origin !== issuerUrl.origin) {
    throw new Error('NEXT_PRIVATE_KERBWELL_GATE_JWKS_URL must be on the issuer origin');
  }

  const reauthUrl = env.NEXT_PRIVATE_KERBWELL_GATE_REAUTH_URL?.trim() || `${issuer}/signer`;

  if (parseOrigin(reauthUrl, 'NEXT_PRIVATE_KERBWELL_GATE_REAUTH_URL').origin !== issuerUrl.origin) {
    throw new Error('NEXT_PRIVATE_KERBWELL_GATE_REAUTH_URL must be on the issuer origin');
  }

  const rawMaxAge = env.NEXT_PRIVATE_KERBWELL_GATE_MAX_AUTH_AGE?.trim();
  const maxAuthAgeSeconds = rawMaxAge ? Number(rawMaxAge) : 15 * 60;

  if (!Number.isInteger(maxAuthAgeSeconds) || maxAuthAgeSeconds < 60 || maxAuthAgeSeconds > 15 * 60) {
    throw new Error('NEXT_PRIVATE_KERBWELL_GATE_MAX_AUTH_AGE must be a whole number of seconds from 60 to 900');
  }

  const rawActionsUrl = env.NEXT_PRIVATE_KERBWELL_GATE_ACTIONS_URL?.trim() || null;
  const actionsUrl = rawActionsUrl
    ? parseOrigin(rawActionsUrl, 'NEXT_PRIVATE_KERBWELL_GATE_ACTIONS_URL').toString()
    : null;

  const passkeyUrl = env.NEXT_PRIVATE_KERBWELL_GATE_PASSKEY_URL?.trim() || `${issuer}/signer/passkey`;

  if (parseOrigin(passkeyUrl, 'NEXT_PRIVATE_KERBWELL_GATE_PASSKEY_URL').origin !== issuerUrl.origin) {
    throw new Error('NEXT_PRIVATE_KERBWELL_GATE_PASSKEY_URL must be on the issuer origin');
  }

  return {
    issuer,
    jwksUrl,
    audience: env.NEXT_PRIVATE_KERBWELL_GATE_AUDIENCE?.trim() || 'sign',
    mode: rawMode,
    reauthUrl,
    maxAuthAgeSeconds,
    actionsUrl,
    passkeyUrl,
  };
};
