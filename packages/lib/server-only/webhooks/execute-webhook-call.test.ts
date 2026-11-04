import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { executeWebhookCall } from './execute-webhook-call';
import { verifyWebhookSignature } from './kerbwell-signature';

// The listener is on loopback, which the SSRF guard refuses; the guard has its own tests.
vi.mock('./assert-webhook-url', () => ({ assertNotPrivateUrl: async () => {} }));

const SECRET = 'not-a-real-wire-secret-for-tests';

let received: { headers: IncomingHttpHeaders; body: string }[] = [];
let url = '';
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    received.push({ headers: req.headers, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  received = [];
  vi.unstubAllEnvs();
});

describe('executeWebhookCall on the wire', () => {
  it('sends a timestamped signature the receiver verifies over the raw body', async () => {
    const result = await executeWebhookCall({ url, body: { event: 'DOCUMENT_COMPLETED', n: 1 }, secret: SECRET });

    expect(result.success).toBe(true);
    expect(received).toHaveLength(1);

    const [{ headers, body }] = received;
    const header = headers['x-kerbwell-signature'];

    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature({ header: String(header), body, secret: SECRET })).toEqual({ ok: true });
    expect(verifyWebhookSignature({ header: String(header), body: `${body} `, secret: SECRET }).ok).toBe(false);
  });

  it('keeps X-Documenso-Secret while the legacy flag is on, and drops it when false', async () => {
    await executeWebhookCall({ url, body: { a: 1 }, secret: SECRET });
    expect(received[0].headers['x-documenso-secret']).toBe(SECRET);

    vi.stubEnv('NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER', 'false');
    await executeWebhookCall({ url, body: { a: 1 }, secret: SECRET });
    expect(received[1].headers['x-documenso-secret']).toBeUndefined();
    expect(received[1].headers['x-kerbwell-signature']).toBeDefined();
  });
});
