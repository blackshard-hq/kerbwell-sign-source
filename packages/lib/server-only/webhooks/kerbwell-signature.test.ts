import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildWebhookHeaders,
  isLegacySecretHeaderEnabled,
  KERBWELL_SIGNATURE_HEADER,
  KERBWELL_SIGNATURE_TOLERANCE_SECONDS,
  signWebhookBody,
  verifyWebhookSignature,
} from './kerbwell-signature';

const SECRET = 'not-a-real-secret-for-tests';
const BODY = JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 7 } });
const NOW = 1_793_750_400; // 4 Nov 2026 00:00 UTC, in seconds

describe('signWebhookBody', () => {
  it('produces t=<unix>,v1=<hex HMAC-SHA256 of "t.body">', () => {
    const header = signWebhookBody({ secret: SECRET, body: BODY, timestamp: NOW });
    const expected = createHmac('sha256', SECRET).update(`${NOW}.${BODY}`).digest('hex');

    expect(header).toBe(`t=${NOW},v1=${expected}`);
    expect(header).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
  });

  it('uses the current time when no timestamp is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW * 1000));

    expect(signWebhookBody({ secret: SECRET, body: BODY })).toMatch(new RegExp(`^t=${NOW},v1=`));

    vi.useRealTimers();
  });
});

describe('verifyWebhookSignature (reference receiver)', () => {
  const header = signWebhookBody({ secret: SECRET, body: BODY, timestamp: NOW });

  it('accepts a fresh, untouched delivery', () => {
    expect(verifyWebhookSignature({ header, body: BODY, secret: SECRET, now: NOW + 10 })).toEqual({ ok: true });
  });

  it('rejects a timestamp older than 5 minutes', () => {
    expect(KERBWELL_SIGNATURE_TOLERANCE_SECONDS).toBe(300);

    const result = verifyWebhookSignature({ header, body: BODY, secret: SECRET, now: NOW + 301 });

    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('accepts a delivery exactly at the 5-minute edge', () => {
    expect(verifyWebhookSignature({ header, body: BODY, secret: SECRET, now: NOW + 300 }).ok).toBe(true);
  });

  it('rejects a timestamp too far in the future', () => {
    const result = verifyWebhookSignature({ header, body: BODY, secret: SECRET, now: NOW - 301 });

    expect(result).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a body tamper', () => {
    const tampered = BODY.replace('"id":7', '"id":8');

    expect(verifyWebhookSignature({ header, body: tampered, secret: SECRET, now: NOW })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects a timestamp rewritten to look fresh', () => {
    const forged = header.replace(`t=${NOW}`, `t=${NOW + 600}`);

    expect(verifyWebhookSignature({ header: forged, body: BODY, secret: SECRET, now: NOW + 600 })).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects the wrong secret', () => {
    expect(verifyWebhookSignature({ header, body: BODY, secret: `${SECRET}x`, now: NOW }).ok).toBe(false);
  });

  it('rejects a missing or malformed header', () => {
    for (const bad of [null, '', 'v1=abc', `t=${NOW}`, `t=abc,v1=${'0'.repeat(64)}`, `t=${NOW},v1=xyz`]) {
      expect(verifyWebhookSignature({ header: bad, body: BODY, secret: SECRET, now: NOW })).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('accepts any of several v1 values (secret rotation)', () => {
    const other = signWebhookBody({ secret: 'another-secret-value', body: BODY, timestamp: NOW });
    const both = `${header},v1=${other.split('v1=')[1]}`;

    expect(verifyWebhookSignature({ header: both, body: BODY, secret: 'another-secret-value', now: NOW }).ok).toBe(
      true,
    );
  });
});

describe('buildWebhookHeaders', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('signs with X-Kerbwell-Signature and keeps the legacy header by default', () => {
    vi.stubEnv('NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER', '');

    const headers = buildWebhookHeaders({ secret: SECRET, body: BODY, timestamp: NOW });

    expect(headers['Content-Type']).toBe('application/json');
    expect(headers[KERBWELL_SIGNATURE_HEADER]).toBe(signWebhookBody({ secret: SECRET, body: BODY, timestamp: NOW }));
    expect(headers['X-Documenso-Secret']).toBe(SECRET);
  });

  it('drops the legacy header when NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER=false', () => {
    vi.stubEnv('NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER', 'false');

    expect(isLegacySecretHeaderEnabled()).toBe(false);

    const headers = buildWebhookHeaders({ secret: SECRET, body: BODY, timestamp: NOW });

    expect(headers).not.toHaveProperty('X-Documenso-Secret');
    expect(headers[KERBWELL_SIGNATURE_HEADER]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('sends no signature for a webhook with no secret', () => {
    vi.stubEnv('NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER', 'false');

    const headers = buildWebhookHeaders({ secret: null, body: BODY, timestamp: NOW });

    expect(headers).not.toHaveProperty(KERBWELL_SIGNATURE_HEADER);
    expect(headers).not.toHaveProperty('X-Documenso-Secret');
  });
});
