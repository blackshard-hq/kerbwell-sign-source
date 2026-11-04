import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({
  config: null as null | { mode: 'all' | 'recipient'; maxAuthAgeSeconds: number; reauthUrl: string },
  // token -> recipient id; the cookie "ok-<id>" holds a session for that recipient
  recipients: new Map<string, number>(),
  authAgeSeconds: 60,
}));

vi.mock('@documenso/lib/server-only/kerbwell-gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@documenso/lib/server-only/kerbwell-gate')>();

  return {
    ...actual,
    getKerbwellGateConfig: () => gate.config,
    checkKerbwellGateForToken: async ({ token, cookieHeader }: { token: string; cookieHeader?: string | null }) => {
      if (!gate.config) {
        return { status: 'not_required' };
      }
      const recipientId = gate.recipients.get(token);
      if (recipientId === undefined) {
        return { status: 'unknown_token' };
      }
      if (cookieHeader !== `ok-${recipientId}`) {
        return { status: 'refused', recipientId };
      }
      return {
        status: 'allowed',
        recipientId,
        config: gate.config,
        authFresh: gate.authAgeSeconds <= gate.config.maxAuthAgeSeconds,
        session: {
          recipientId,
          envelopeId: 'envelope_abc',
          authTime: new Date(Date.now() - gate.authAgeSeconds * 1000),
        },
      };
    },
  };
});

const { classifyKerbwellGatePath, kerbwellGatePageGuard } = await import('./kerbwell-gate');

const CONFIG = { mode: 'all' as const, maxAuthAgeSeconds: 900, reauthUrl: 'https://auth.kerbwell.com.au/signer' };

beforeEach(() => {
  gate.config = CONFIG;
  gate.recipients = new Map([
    ['tok-a', 1],
    ['tok-b', 2],
  ]);
  gate.authAgeSeconds = 60;
});

describe('classifyKerbwellGatePath', () => {
  it('covers the signing pages, their data and child routes, files, embeds, reports and direct links', () => {
    expect(classifyKerbwellGatePath('/sign/tok-a')).toMatchObject({ token: 'tok-a', isPage: true });
    expect(classifyKerbwellGatePath('/sign/tok-a.data')).toMatchObject({ token: 'tok-a', isPage: false });
    expect(classifyKerbwellGatePath('/sign/tok-a/complete')).toMatchObject({ token: 'tok-a', isPage: true });
    expect(classifyKerbwellGatePath('/sign/tok-a/complete.data')).toMatchObject({ token: 'tok-a', isPage: false });
    expect(classifyKerbwellGatePath('/embed/sign/tok-a')).toMatchObject({ token: 'tok-a' });
    expect(classifyKerbwellGatePath('/report/tok-a')).toMatchObject({ token: 'tok-a' });
    expect(classifyKerbwellGatePath('/api/files/token/tok-a/envelopeItem/x')).toMatchObject({
      token: 'tok-a',
      isPage: false,
    });
    expect(classifyKerbwellGatePath('/d/direct-1')).toMatchObject({ token: null });
    expect(classifyKerbwellGatePath('/embed/direct/direct-1')).toMatchObject({ token: null });
  });

  it('leaves the inactive page, QR certificate files and other paths alone', () => {
    expect(classifyKerbwellGatePath('/sign/tok-a/inactive')).toBeNull();
    expect(classifyKerbwellGatePath('/sign/tok-a/inactive.data')).toBeNull();
    expect(classifyKerbwellGatePath('/api/files/token/qr_abc/envelopeItem/x')).toBeNull();
    expect(classifyKerbwellGatePath('/signin')).toBeNull();
    expect(classifyKerbwellGatePath('/dashboard')).toBeNull();
    expect(classifyKerbwellGatePath('/documents')).toBeNull();
  });
});

describe('kerbwellGatePageGuard', () => {
  const app = new Hono();
  app.use('*', kerbwellGatePageGuard);
  app.get('*', (c) => c.text('page'));

  const get = (path: string, cookie?: string) =>
    app.request(`http://sign.test${path}`, { headers: cookie ? { cookie } : {} });

  it('sends a token-only visit to the inactive page', async () => {
    const res = await get('/sign/tok-a');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/sign/tok-a/inactive');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('lets the bound recipient through and refuses a cookie for another recipient', async () => {
    expect((await get('/sign/tok-a', 'ok-1')).status).toBe(200);
    expect((await get('/sign/tok-b', 'ok-1')).status).toBe(303);
  });

  it('answers 403 to data and file requests without the cookie', async () => {
    expect((await get('/sign/tok-a.data')).status).toBe(403);
    expect((await get('/api/files/token/tok-a/envelopeItem/x')).status).toBe(403);
  });

  it('refuses direct links under mode all, and passes everything with the gate off', async () => {
    expect((await get('/d/direct-1')).headers.get('location')).toBe('/link-inactive');
    gate.config = null;
    expect((await get('/sign/tok-a')).status).toBe(200);
    expect((await get('/d/direct-1')).status).toBe(200);
  });

  it('leaves unknown tokens to the route (404 there)', async () => {
    expect((await get('/sign/nobody')).status).toBe(200);
  });
});
