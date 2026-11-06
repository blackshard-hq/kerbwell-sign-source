/**
 * Kerbwell: no public sign-in or dashboard (apps/remix/server/public-surface-lock.ts).
 *
 * The server under test runs with KERBWELL_PUBLIC_SIGNIN_REDIRECT set and
 * NEXT_PRIVATE_INTERNAL_API_HOSTS naming one host. KERBWELL_E2E_INTERNAL_URL reaches it on that
 * host, KERBWELL_E2E_PUBLIC_URL (default NEXT_PUBLIC_WEBAPP_URL) on any other name.
 *
 *   KERBWELL_PUBLIC_SIGNIN_REDIRECT=https://app.kerbwell.com.au NEXT_PRIVATE_INTERNAL_API_HOSTS=127.0.0.1 (server)
 *   KERBWELL_E2E_SIGNIN_REDIRECT=https://app.kerbwell.com.au
 *   KERBWELL_E2E_INTERNAL_URL=http://127.0.0.1:3000 KERBWELL_E2E_PUBLIC_URL=http://localhost:3000
 *   KERBWELL_E2E_API_TOKEN=<a team API token on the server, e.g. the bootstrap's>
 *
 * The signing-link test creates and sends a one-signer envelope through the internal API, then
 * opens the signing link on the public host in a browser.
 *
 * Skipped when KERBWELL_E2E_SIGNIN_REDIRECT is unset (the suite then runs with the lock off).
 */
import fs from 'node:fs';
import path from 'node:path';
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { expect, test } from '@playwright/test';

const REDIRECT = process.env.KERBWELL_E2E_SIGNIN_REDIRECT;
const INTERNAL_URL = process.env.KERBWELL_E2E_INTERNAL_URL ?? '';
const PUBLIC_URL = process.env.KERBWELL_E2E_PUBLIC_URL || NEXT_PUBLIC_WEBAPP_URL();
const TOKEN = process.env.KERBWELL_E2E_API_TOKEN ?? '';

const location = () => new URL(REDIRECT ?? 'http://invalid').toString();

test.describe('kerbwell public surface lock', () => {
  test.skip(!REDIRECT, 'KERBWELL_E2E_SIGNIN_REDIRECT is not set');

  test('sign-in, sign-up, password and dashboard pages redirect on the public host', async ({ request }) => {
    for (const p of [
      '/',
      '/signin',
      '/signup',
      '/forgot-password',
      '/reset-password',
      '/inbox',
      '/settings/profile',
      '/admin',
      '/t/kerbwell/documents',
    ]) {
      const res = await request.get(`${PUBLIC_URL}${p}`, { maxRedirects: 0 });
      expect(res.status(), p).toBe(302);
      expect(res.headers().location, p).toBe(location());
    }
  });

  test('static, well-known, manifest, health and a bogus signing token do not redirect', async ({ request }) => {
    const css = await request.get(`${PUBLIC_URL}/static/kerbwell-brand.css`, { maxRedirects: 0 });
    expect(css.status()).toBe(200);

    for (const p of ['/.well-known/security.txt', '/site.webmanifest', '/api/health', '/favicon.ico']) {
      const res = await request.get(`${PUBLIC_URL}${p}`, { maxRedirects: 0 });
      expect(res.status(), p).toBe(200);
    }

    for (const p of ['/sign/not-a-real-token', '/d/not-a-real-token']) {
      const res = await request.get(`${PUBLIC_URL}${p}`, { maxRedirects: 0 });
      expect(res.status(), p).not.toBe(302);
      expect(res.headers().location, p).toBeUndefined();
    }
  });

  test('the internal host still reaches sign-in', async ({ request }) => {
    test.skip(!INTERNAL_URL, 'KERBWELL_E2E_INTERNAL_URL is not set');

    const res = await request.get(`${INTERNAL_URL}/signin`, { maxRedirects: 0 });
    expect(res.status()).toBe(200);

    const edge = await request.get(`${INTERNAL_URL}/signin`, { maxRedirects: 0, headers: { 'cf-ray': 'e2e' } });
    expect(edge.status()).toBe(302);
  });

  test('a signing link opens on the public host', async ({ request, page }) => {
    test.skip(!INTERNAL_URL || !TOKEN, 'KERBWELL_E2E_INTERNAL_URL or KERBWELL_E2E_API_TOKEN is not set');

    const api = `${INTERNAL_URL}/api/v2/envelope`;
    const headers = { Authorization: `Bearer ${TOKEN}` };
    const title = `Kerbwell lock e2e ${Date.now()}`;

    const formData = new FormData();
    formData.append(
      'payload',
      JSON.stringify({
        title,
        type: 'DOCUMENT',
        meta: { distributionMethod: 'NONE' },
        recipients: [
          {
            email: `signer-${Date.now()}@example.com`,
            name: 'Lock Signer',
            role: 'SIGNER',
            fields: [{ type: 'SIGNATURE', page: 1, positionX: 10, positionY: 10, width: 15, height: 5 }],
          },
        ],
      }),
    );
    const pdf = fs.readFileSync(path.join(__dirname, '../../../../assets/example.pdf'));
    formData.append('files', new File([pdf], 'example.pdf', { type: 'application/pdf' }));

    const created = await request.post(`${api}/create`, { headers, multipart: formData });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = await created.json();

    const sent = await request.post(`${api}/distribute`, { headers, data: { envelopeId: id } });
    expect(sent.ok(), await sent.text()).toBeTruthy();
    const { recipients } = await sent.json();
    const signingUrl = new URL(recipients[0].signingUrl);
    const publicLink = `${PUBLIC_URL}${signingUrl.pathname}`;

    const raw = await request.get(publicLink, { maxRedirects: 0 });
    expect(raw.status()).toBe(200);

    const response = await page.goto(publicLink);
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(signingUrl.pathname);
    await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Sign Document/ })).toBeVisible();
  });
});
