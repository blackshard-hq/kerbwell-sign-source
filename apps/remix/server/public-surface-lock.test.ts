import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { parseInternalApiHosts } from './middleware';
import {
  createPublicSurfaceLock,
  isPublicSurfacePath,
  parseSigninRedirect,
  publicSurfaceDecision,
} from './public-surface-lock';

const INTERNAL = 'kerbwell-esign.internal.example.australiaeast.azurecontainerapps.io';
const PUBLIC = 'sign.kerbwell.com.au';
const TARGET = 'https://app.kerbwell.com.au';

const REDIRECTED = [
  '/',
  '/_root.data',
  '/signin',
  '/signin.data',
  '/SignIn',
  '//signin',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/reset-password/abc123',
  '/check-email',
  '/unverified-account',
  '/verify-email',
  '/o/kerbwell/signin',
  '/organisation/invite/abc',
  '/inbox',
  '/dashboard',
  '/documents',
  '/templates',
  '/t/kerbwell/documents',
  '/t/kerbwell/documents/envelope_abc/edit',
  '/t/kerbwell/settings/tokens',
  '/o/kerbwell/settings/general',
  '/settings/profile',
  '/settings/security',
  '/admin',
  '/admin/users',
  '/p/somebody',
  '/does-not-exist',
];

const ALLOWED = [
  '/sign/abcdef123456',
  '/sign/abcdef123456/complete',
  '/sign/abcdef123456.data',
  '/d/abcdef123456',
  '/embed/sign/abcdef123456',
  '/embed/direct/abcdef123456',
  '/embed/v1/authoring/document/create',
  '/embed/v2/authoring/envelope/create',
  '/share/abc',
  '/report/abcdef123456',
  '/articles/signature-disclosure',
  '/__htmltopdf/certificate',
  '/__manifest',
  '/api/health',
  '/api/auth/session',
  '/api/auth/passkey/authorize',
  '/api/trpc/recipient.completeDocumentWithToken',
  '/api/kerbwell/gate',
  '/api/v2/envelope',
  '/assets/root-abc123.js',
  '/static/kerbwell-brand.css',
  '/static/kerbwell-geist-400.woff2',
  '/fonts/inter-regular.ttf',
  '/.well-known/security.txt',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/robots.txt',
  '/opengraph-image.jpg',
];

const buildApp = (redirectRaw: string | undefined, hostsRaw: string | null = INTERNAL) => {
  const app = new Hono();
  app.use('*', createPublicSurfaceLock(parseInternalApiHosts(hostsRaw ?? undefined), parseSigninRedirect(redirectRaw)));
  app.all('*', (c) => c.text(`app ${c.req.path}`));
  return app;
};

const get = (app: Hono, path: string, host: string, extra: Record<string, string> = {}) =>
  app.request(`http://${host}${path}`, { headers: { host, ...extra } });

describe('public surface lock', () => {
  it('changes nothing when KERBWELL_PUBLIC_SIGNIN_REDIRECT is unset or empty', async () => {
    for (const raw of [undefined, '', '   ']) {
      const app = buildApp(raw);
      for (const path of [...REDIRECTED, ...ALLOWED]) {
        const res = await get(app, path, PUBLIC);
        expect(res.status, `${String(raw)} ${path}`).toBe(200);
        expect(res.headers.get('location')).toBeNull();
      }
    }
  });

  it('redirects sign-in, sign-up, password, dashboard and unknown pages on a public host', async () => {
    const app = buildApp(TARGET);
    for (const path of REDIRECTED) {
      const res = await get(app, path, PUBLIC);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location'), path).toBe(`${TARGET}/`);
      expect(res.headers.get('cache-control'), path).toBe('no-store');
    }
  });

  it('redirects every method, not only GET', async () => {
    const app = buildApp(TARGET);
    for (const method of ['POST', 'HEAD', 'PUT']) {
      const res = await app.request(`http://${PUBLIC}/signin`, { method, headers: { host: PUBLIC } });
      expect(res.status, method).toBe(302);
    }
  });

  it('keeps the signing, embed, auth, API, static and well-known paths working on a public host', async () => {
    const app = buildApp(TARGET);
    for (const path of ALLOWED) {
      const res = await get(app, path, PUBLIC);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe(`app ${path}`);
    }
  });

  it('lets the internal host reach sign-in and the dashboard, with or without a port', async () => {
    const app = buildApp(TARGET, `other.internal, ${INTERNAL.toUpperCase()}`);
    for (const host of [INTERNAL, `${INTERNAL}:443`, `${INTERNAL}.`]) {
      for (const path of ['/', '/signin', '/admin', '/t/kerbwell/documents']) {
        const res = await get(app, path, host);
        expect(res.status, `${host} ${path}`).toBe(200);
      }
    }
  });

  it('redirects an internal Host that arrived through the public edge', async () => {
    const app = buildApp(TARGET);
    for (const header of ['cf-ray', 'cf-connecting-ip', 'cdn-loop']) {
      const res = await get(app, '/signin', INTERNAL, { [header]: 'x' });
      expect(res.status, header).toBe(302);
    }
  });

  it('redirects everyone when no internal host is configured', async () => {
    const app = buildApp(TARGET, null);
    expect((await get(app, '/signin', INTERNAL)).status).toBe(302);
    expect((await get(app, '/signin', 'localhost:3000')).status).toBe(302);
  });

  it('answers 404 instead of opening the pages when the value is not a URL', async () => {
    for (const raw of ['app.kerbwell.com.au', 'javascript:alert(1)', 'ftp://app.kerbwell.com.au', 'https://u:p@x']) {
      const app = buildApp(raw);
      const res = await get(app, '/signin', PUBLIC);
      expect(res.status, raw).toBe(404);
      expect(res.headers.get('location')).toBeNull();
      expect((await get(app, '/sign/abc', PUBLIC)).status, raw).toBe(200);
    }
  });

  it('parses the redirect value', () => {
    expect(parseSigninRedirect(undefined)).toEqual({ kind: 'off' });
    expect(parseSigninRedirect(' https://app.kerbwell.com.au ')).toEqual({
      kind: 'redirect',
      url: 'https://app.kerbwell.com.au/',
    });
    expect(parseSigninRedirect('/relative')).toEqual({ kind: 'invalid' });
  });

  it('does not treat look-alike paths as public', () => {
    for (const path of ['/signer', '/sign-in', '/dashboard/sign/x', '/apisomething', '/staticx/a', '/embedded']) {
      expect(isPublicSurfacePath(path), path).toBe(false);
    }
    expect(
      publicSurfaceDecision({
        path: '/signin',
        host: PUBLIC,
        headers: { get: () => null },
        internalHosts: new Set([INTERNAL]),
        redirect: { kind: 'redirect', url: `${TARGET}/` },
      }),
    ).toEqual({ action: 'redirect', url: `${TARGET}/` });
  });
});
