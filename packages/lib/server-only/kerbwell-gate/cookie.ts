import { KERBWELL_GATE_COOKIE_NAME, KERBWELL_GATE_SESSION_TTL_SECONDS } from './config';

/**
 * The gate cookie. `__Host-` pins it to this exact host, with Path=/ and Secure. HttpOnly keeps it
 * from page script; SameSite=Lax lets the 303 after the identity service's top-level POST carry it.
 * The value is an opaque 256-bit session handle; only its SHA-256 is stored.
 */
export const serializeKerbwellGateCookie = (value: string, maxAgeSeconds = KERBWELL_GATE_SESSION_TTL_SECONDS) =>
  [
    `${KERBWELL_GATE_COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');

export const clearKerbwellGateCookie = () => serializeKerbwellGateCookie('', 0);

/** Reads the gate cookie value out of a Cookie header. Only a well-formed handle is returned. */
export const readKerbwellGateCookie = (cookieHeader: string | null | undefined): string | null => {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');

    if (index === -1) {
      continue;
    }

    if (part.slice(0, index).trim() !== KERBWELL_GATE_COOKIE_NAME) {
      continue;
    }

    const value = part.slice(index + 1).trim();

    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }

  return null;
};
