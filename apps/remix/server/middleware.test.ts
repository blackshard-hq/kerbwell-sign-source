import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createInternalApiHostLock, isApiRequestRefused, normaliseHost, parseInternalApiHosts } from './middleware';

const INTERNAL = 'kerbwell-esign.internal.example.australiaeast.azurecontainerapps.io';

const buildApp = (raw: string | undefined) => {
  const app = new Hono();
  app.use('*', createInternalApiHostLock(parseInternalApiHosts(raw)));
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.get('/api/v1/documents', (c) => c.json({ v: 1 }));
  app.get('/api/v2/envelope', (c) => c.json({ v: 2 }));
  app.get('/api/v2-beta/envelope', (c) => c.json({ v: 'beta' }));
  app.post('/api/kerbwell/gate', (c) => c.json({ gate: true }));
  app.get('/api/trpc/x', (c) => c.json({ trpc: true }));
  app.get('/sign/:token', (c) => c.text('sign'));
  return app;
};

const get = (app: Hono, path: string, host: string, extra: Record<string, string> = {}) =>
  app.request(`http://${host}${path}`, { headers: { host, ...extra } });

describe('internal API host lock', () => {
  it('is off when NEXT_PRIVATE_INTERNAL_API_HOSTS is unset or empty', async () => {
    for (const raw of [undefined, '', ' , ']) {
      const res = await get(buildApp(raw), '/api/v2/envelope', 'sign.kerbwell.com.au');
      expect(res.status).toBe(200);
    }
  });

  it('returns 404 on a public host for v1, v2 and v2-beta', async () => {
    const app = buildApp(INTERNAL);
    for (const path of [
      '/api/v1/documents',
      '/api/v2/envelope',
      '/api/v2-beta/envelope',
      '/api/v2',
      '/api/V2/envelope',
    ]) {
      const res = await get(app, path, 'sign.kerbwell.com.au');
      expect(res.status, path).toBe(404);
    }
  });

  it('answers on the internal host, with or without a port', async () => {
    const app = buildApp(`other.internal, ${INTERNAL.toUpperCase()}`);
    expect((await get(app, '/api/v2/envelope', INTERNAL)).status).toBe(200);
    expect((await get(app, '/api/v2/envelope', `${INTERNAL}:443`)).status).toBe(200);
    expect((await get(app, '/api/v1/documents', `${INTERNAL}.`)).status).toBe(200);
  });

  it('refuses an internal Host that arrived through the public edge', async () => {
    const app = buildApp(INTERNAL);
    expect((await get(app, '/api/v2/envelope', INTERNAL, { 'cf-ray': '8f0000000000-SYD' })).status).toBe(404);
    expect((await get(app, '/api/v2/envelope', INTERNAL, { 'cf-connecting-ip': '203.0.113.9' })).status).toBe(404);
  });

  it('keeps health, the gate, tRPC and the signing pages public', async () => {
    const app = buildApp(INTERNAL);
    expect((await get(app, '/api/health', 'sign.kerbwell.com.au')).status).toBe(200);
    expect(
      (
        await app.request('http://sign.kerbwell.com.au/api/kerbwell/gate', {
          method: 'POST',
          headers: { host: 'sign.kerbwell.com.au' },
        })
      ).status,
    ).toBe(200);
    expect((await get(app, '/api/trpc/x', 'sign.kerbwell.com.au')).status).toBe(200);
    expect((await get(app, '/sign/abc', 'sign.kerbwell.com.au')).status).toBe(200);
  });

  it('does not treat look-alike paths as the API', () => {
    const hosts = parseInternalApiHosts(INTERNAL);
    const headers = { get: () => null };
    expect(isApiRequestRefused({ path: '/api/v20', host: 'x', headers, internalHosts: hosts })).toBe(false);
    expect(isApiRequestRefused({ path: '/api/v1x/a', host: 'x', headers, internalHosts: hosts })).toBe(false);
    expect(isApiRequestRefused({ path: '/api/v1', host: 'x', headers, internalHosts: hosts })).toBe(true);
  });

  it('normalises hosts', () => {
    expect(normaliseHost(' Sign.Kerbwell.com.au:8443 ')).toBe('sign.kerbwell.com.au');
    expect(normaliseHost('[::1]:3000')).toBe('[::1]');
    expect(normaliseHost(undefined)).toBe('');
  });
});
