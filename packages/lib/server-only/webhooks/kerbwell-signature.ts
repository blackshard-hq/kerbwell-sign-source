import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Kerbwell webhook signature.
 *
 *   X-Kerbwell-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${body}`)>
 *
 * `body` is the exact request body bytes sent on the wire. A receiver recomputes the HMAC over
 * the timestamp it was given and the raw body, compares in constant time, and refuses a
 * timestamp more than KERBWELL_SIGNATURE_TOLERANCE_SECONDS away from its own clock. Several
 * v1 values may appear (comma separated) while a secret is being rotated.
 *
 * The upstream X-Documenso-Secret header (the secret itself, in clear) is still sent while
 * NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER is anything other than `false`, so a receiver that
 * only knows the legacy check keeps working until it is upgraded.
 */
export const KERBWELL_SIGNATURE_HEADER = 'X-Kerbwell-Signature';
export const LEGACY_SECRET_HEADER = 'X-Documenso-Secret';
export const KERBWELL_SIGNATURE_TOLERANCE_SECONDS = 300;

const hmacHex = (secret: string, timestamp: number, body: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');

export const signWebhookBody = (options: { secret: string; body: string; timestamp?: number }): string => {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);

  return `t=${timestamp},v1=${hmacHex(options.secret, timestamp, options.body)}`;
};

export const isLegacySecretHeaderEnabled = (): boolean =>
  (process.env['NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER'] ?? '').trim().toLowerCase() !== 'false';

export const buildWebhookHeaders = (options: {
  secret: string | null;
  body: string;
  timestamp?: number;
}): Record<string, string> => {
  const { secret, body, timestamp } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (secret) {
    headers[KERBWELL_SIGNATURE_HEADER] = signWebhookBody({ secret, body, timestamp });
  }

  if (isLegacySecretHeaderEnabled()) {
    headers[LEGACY_SECRET_HEADER] = secret ?? '';
  }

  return headers;
};

export type TVerifyWebhookSignatureResult = { ok: true } | { ok: false; reason: 'malformed' | 'stale' | 'mismatch' };

/**
 * The receiver side, kept next to the signer so both read the same format. Kerbwell's staff
 * app has its own implementation of the same contract; this one is the reference the tests
 * hold both to.
 */
export const verifyWebhookSignature = (options: {
  header: string | null | undefined;
  body: string;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): TVerifyWebhookSignatureResult => {
  const { header, body, secret } = options;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? KERBWELL_SIGNATURE_TOLERANCE_SECONDS;

  if (typeof header !== 'string' || header.length === 0 || header.length > 1024) {
    return { ok: false, reason: 'malformed' };
  }

  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index <= 0) {
      return { ok: false, reason: 'malformed' };
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    if (key === 't') {
      if (!/^\d{1,12}$/.test(value) || timestamp !== null) {
        return { ok: false, reason: 'malformed' };
      }
      timestamp = Number(value);
    } else if (key === 'v1') {
      if (!/^[0-9a-f]{64}$/.test(value)) {
        return { ok: false, reason: 'malformed' };
      }
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = Buffer.from(hmacHex(secret, timestamp, body), 'hex');
  const matched = signatures.some((signature) => timingSafeEqual(Buffer.from(signature, 'hex'), expected));

  if (!matched) {
    return { ok: false, reason: 'mismatch' };
  }

  if (Math.abs(now - timestamp) > tolerance) {
    return { ok: false, reason: 'stale' };
  }

  return { ok: true };
};
