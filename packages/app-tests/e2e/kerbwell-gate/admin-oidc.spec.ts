/**
 * Kerbwell Sign admin sign-in: OIDC against Kerbwell Identity only, for the kerbwell-sign-admin
 * role with a passkey amr.
 *
 * The server under test runs with NEXT_PUBLIC_KERBWELL_ADMIN_OIDC_ONLY=true and its OIDC client
 * pointed at this spec's fake identity service (fake-identity.ts):
 *
 *   NEXT_PRIVATE_OIDC_WELL_KNOWN=<KERBWELL_E2E_GATE_ISSUER>/.well-known/openid-configuration
 *   NEXT_PRIVATE_OIDC_CLIENT_ID=<KERBWELL_E2E_OIDC_CLIENT_ID, default kerbwell-sign-e2e>
 *   NEXT_PRIVATE_OIDC_CLIENT_SECRET=<anything>
 *
 * Skipped unless KERBWELL_E2E_ADMIN_OIDC=1.
 */
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { prisma } from '@documenso/prisma';
import { expect, test } from '@playwright/test';

import { FakeKerbwellIdentity } from './fake-identity';

const ENABLED = process.env.KERBWELL_E2E_ADMIN_OIDC === '1';
const APP_URL = NEXT_PUBLIC_WEBAPP_URL();

test.describe.configure({ mode: 'serial' });

let identity: FakeKerbwellIdentity;

test.describe('kerbwell sign admin sign-in', () => {
  test.skip(!ENABLED, 'KERBWELL_E2E_ADMIN_OIDC is not 1');

  test.beforeAll(async () => {
    identity = new FakeKerbwellIdentity(APP_URL);
    await identity.start();
  });

  test.afterAll(async () => {
    await identity?.stop();
  });

  test('the password form is absent and every password route is closed', async ({ request }) => {
    const signin = await request.get('/signin?error=probe');
    expect(signin.status()).toBe(200);
    const html = await signin.text();
    expect(html).not.toMatch(/type="password"/);
    expect(html).not.toMatch(/Forgot your password/);

    const signup = await request.get('/signup', { maxRedirects: 0 });
    expect([302, 303]).toContain(signup.status());

    for (const path of [
      '/api/auth/email-password/authorize',
      '/api/auth/email-password/signup',
      '/api/auth/email-password/forgot-password',
      '/api/auth/passkey/authorize',
      '/api/auth/oauth/authorize/google',
    ]) {
      const res = await request.post(path, { data: {} });
      expect(res.status(), path).toBe(403);
    }

    // The retired portal-session handoff is gone.
    expect((await request.get('/api/auth/portal-session/sso')).status()).toBe(404);
  });

  test('an OIDC sign-in without a passkey amr is refused', async ({ page }) => {
    identity.nextAdminLogin = {
      email: `kw-admin-pwd-${Date.now()}@example.com`,
      name: 'Admin Without Passkey',
      roles: ['kerbwell-sign-admin'],
      amr: ['pwd', 'otp'],
    };

    await page.goto('/signin');
    await page.waitForURL(/\/signin\?error=KERBWELL_ADMIN_REFUSED/);
    await expect(page.getByText('signed in with a passkey')).toBeVisible();

    expect(await prisma.user.count({ where: { email: identity.nextAdminLogin.email } })).toBe(0);

    const session = (await (await page.request.get('/api/auth/session')).json()) as { isAuthenticated?: boolean };
    expect(session.isAuthenticated).not.toBe(true);
  });

  test('an OIDC sign-in without the admin role is refused', async ({ page }) => {
    identity.nextAdminLogin = {
      email: `kw-admin-norole-${Date.now()}@example.com`,
      name: 'Staff Member',
      roles: ['staff'],
      amr: ['passkey'],
    };

    await page.goto('/signin');
    await page.waitForURL(/\/signin\?error=KERBWELL_ADMIN_REFUSED/);
    expect(await prisma.user.count({ where: { email: identity.nextAdminLogin.email } })).toBe(0);
  });

  test('an OIDC sign-in with the admin role and a passkey signs in', async ({ page }) => {
    identity.nextAdminLogin = {
      email: `kw-admin-ok-${Date.now()}@example.com`,
      name: 'Kerbwell Admin',
      roles: ['kerbwell-sign-admin'],
      amr: ['passkey', 'user'],
    };

    await page.goto('/signin');
    await page.waitForURL((url) => !url.pathname.startsWith('/signin') && url.origin === new URL(APP_URL).origin);

    const session = (await (await page.request.get('/api/auth/session')).json()) as {
      isAuthenticated?: boolean;
      user?: { email?: string } | null;
    };
    expect(session.isAuthenticated).toBe(true);
    expect(session.user?.email).toBe(identity.nextAdminLogin.email);
    expect(await prisma.user.count({ where: { email: identity.nextAdminLogin.email } })).toBe(1);
  });
});
