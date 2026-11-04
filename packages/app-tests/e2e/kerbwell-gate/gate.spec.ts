/**
 * Kerbwell gate: a signer reaches a document only through a Kerbwell Identity assertion.
 *
 * The server under test runs with NEXT_PRIVATE_KERBWELL_GATE_ISSUER=<KERBWELL_E2E_GATE_ISSUER>
 * (default http://127.0.0.1:4455). This spec serves that issuer itself (fake-identity.ts): the
 * JWKS the app fetches, the auto-submitted POST to /api/kerbwell/gate, and the prompt=login
 * re-entry. It seeds documents straight into the app's database (NEXT_PRIVATE_DATABASE_URL).
 *
 * Skipped when KERBWELL_E2E_GATE_ISSUER is unset (the upstream suite runs with the gate off).
 */
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { createRecipientAuthOptions } from '@documenso/lib/utils/document-auth';
import { prisma } from '@documenso/prisma';
import { seedPendingDocumentNoFields, seedPendingDocumentWithFullFields } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { DocumentStatus, FieldType } from '@prisma/client';

import { signSignaturePad } from '../fixtures/signature';
import { FakeKerbwellIdentity } from './fake-identity';

const ENABLED = Boolean(process.env.KERBWELL_E2E_GATE_ISSUER);
const APP_URL = NEXT_PUBLIC_WEBAPP_URL();

test.describe.configure({ mode: 'serial' });

let identity: FakeKerbwellIdentity;

const seedEnvelope = async (signers = 1) => {
  const { user, team } = await seedUser();
  const emails = Array.from({ length: signers }, (_, i) => `kw-gate-${Date.now()}-${i}@example.com`);

  const { document, recipients } = await seedPendingDocumentNoFields({
    owner: user,
    teamId: team.id,
    recipients: emails,
    updateDocumentOptions: { status: DocumentStatus.PENDING },
  });

  return { envelopeId: document.id, recipients };
};

const openThroughGate = async (page: Page, assertion: string) => {
  await page.goto(identity.postUrl(assertion));
  await page.waitForURL((url) => url.origin === new URL(APP_URL).origin && !url.pathname.startsWith('/api/'));
};

const freshPage = async (browser: Browser) => (await browser.newContext()).newPage();

/**
 * Complete, then Sign agreement. A click that lands before the page has hydrated opens nothing,
 * so Complete is clicked again until the confirmation dialog is up.
 */
const completeAndSign = async (page: Page) => {
  const sign = page.getByRole('dialog').getByRole('button', { name: 'Sign agreement' });

  await expect(async () => {
    await page.getByRole('button', { name: 'Complete' }).click();
    await expect(sign).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  await sign.click();
};

const INACTIVE = 'This link is no longer active';
const RETRY = 'We could not confirm it is you';

test.describe('kerbwell gate', () => {
  test.skip(!ENABLED, 'KERBWELL_E2E_GATE_ISSUER is not set');

  test.beforeAll(async () => {
    identity = new FakeKerbwellIdentity(APP_URL);
    await identity.start();
  });

  test.afterAll(async () => {
    await identity?.stop();
  });

  test('a token on its own shows the inactive page, in any browser', async ({ browser }) => {
    const { recipients } = await seedEnvelope();
    const page = await freshPage(browser);

    await page.goto(`/sign/${recipients[0].token}`);

    await expect(page).toHaveURL(new RegExp(`/sign/${recipients[0].token}/inactive$`));
    await expect(page.getByRole('heading', { name: INACTIVE })).toBeVisible();
    await expect(page.getByText('Sign Document')).toHaveCount(0);

    // The child pages and the PDF routes are closed too.
    const complete = await page.request.get(`/sign/${recipients[0].token}/complete`, { maxRedirects: 0 });
    expect(complete.status()).toBe(303);

    const data = await page.request.get(`/sign/${recipients[0].token}.data`, { maxRedirects: 0 });
    expect(data.status()).toBe(403);
  });

  test('the gate opens the document, sets a __Host- cookie and logs identity and consent', async ({ browser }) => {
    const { envelopeId, recipients } = await seedEnvelope();
    const page = await freshPage(browser);

    await openThroughGate(page, await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId }));

    await expect(page).toHaveURL(new RegExp(`/sign/${recipients[0].token}$`));
    await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

    const cookies = await page.context().cookies();
    const gate = cookies.find((c) => c.name === '__Host-kw_gate');
    expect(gate).toBeDefined();
    expect(gate).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });

    const res = await page.request.get(`/sign/${recipients[0].token}`);
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
    expect(res.headers()['cache-control']).toBe('no-store');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'self'");

    const logs = await prisma.documentAuditLog.findMany({
      where: { envelopeId, type: { in: ['KERBWELL_IDENTITY_VERIFIED', 'KERBWELL_CONSENT_GIVEN'] } },
    });

    const identityLog = logs.find((l) => l.type === 'KERBWELL_IDENTITY_VERIFIED');
    expect(identityLog?.data).toMatchObject({
      recipientId: recipients[0].id,
      acr: 'kw-sign-l1',
      amr: ['otp_sms'],
      singleFactor: false,
      verifiedIpAddress: '203.0.113.10',
      verifiedUserAgent: 'Mozilla/5.0 (e2e)',
      cfCity: 'Brisbane',
    });
    expect(logs.find((l) => l.type === 'KERBWELL_CONSENT_GIVEN')?.data).toMatchObject({
      consentVersion: 'au-eta-2026-11-v1',
    });
  });

  test('the token pasted into a fresh browser cannot open or sign', async ({ browser }) => {
    const { envelopeId, recipients } = await seedEnvelope();
    const signer = await freshPage(browser);
    await openThroughGate(signer, await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId }));
    await expect(signer.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

    const other = await freshPage(browser);
    await other.goto(`/sign/${recipients[0].token}`);
    await expect(other.getByRole('heading', { name: INACTIVE })).toBeVisible();

    // Signing and completing by tRPC without the cookie: 403.
    for (const path of [
      'recipient.completeDocumentWithToken',
      'field.signFieldWithToken',
      'recipient.rejectDocumentWithToken',
    ]) {
      const res = await other.request.post(`/api/trpc/${path}?batch=1`, {
        data: { 0: { json: { token: recipients[0].token, documentId: 0, fieldId: 0, value: 'x', reason: 'x' } } },
      });
      expect(res.status(), path).toBe(403);
    }
  });

  test('a cookie for recipient A is refused on recipient B', async ({ browser }) => {
    const { envelopeId, recipients } = await seedEnvelope(2);
    const [a, b] = recipients;
    const page = await freshPage(browser);

    await openThroughGate(page, await identity.mintAssertion({ recipientId: a.id, envelopeId }));
    await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

    await page.goto(`/sign/${b.token}`);
    await expect(page.getByRole('heading', { name: INACTIVE })).toBeVisible();

    const res = await page.request.post('/api/trpc/recipient.completeDocumentWithToken?batch=1', {
      data: { 0: { json: { token: b.token, documentId: 0 } } },
    });
    expect(res.status()).toBe(403);
  });

  test('a replayed assertion is refused', async ({ browser }) => {
    const { envelopeId, recipients } = await seedEnvelope();
    const assertion = await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId });

    const first = await freshPage(browser);
    await openThroughGate(first, assertion);
    await expect(first.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

    const second = await freshPage(browser);
    await openThroughGate(second, assertion);
    await expect(second).toHaveURL(/\/link-inactive\?reason=retry$/);
    await expect(second.getByRole('heading', { name: RETRY })).toBeVisible();
    expect((await second.context().cookies()).some((c) => c.name === '__Host-kw_gate')).toBe(false);
  });

  test('an expired assertion, a wrong audience, a wrong envelope and stale consent are refused', async ({
    browser,
  }) => {
    const { envelopeId, recipients } = await seedEnvelope();
    const now = Math.floor(Date.now() / 1000);

    const cases = [
      await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId, iat: now - 600, exp: now - 480 }),
      await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId, audience: 'portal' }),
      await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId: 'envelope_someone_else' }),
      // Consent to wording other than the disclosure the fork shows.
      await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId, consentVersion: 'au-eta-2026-10-v0' }),
      await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId, consentHash: 'c'.repeat(64) }),
    ];

    for (const assertion of cases) {
      const page = await freshPage(browser);
      await openThroughGate(page, assertion);
      await expect(page.getByRole('heading', { name: RETRY })).toBeVisible();
    }
  });

  test('Complete after 16 minutes forces a re-auth round trip; at 14 minutes it does not', async ({ browser }) => {
    const now = Math.floor(Date.now() / 1000);

    // 16 minutes: Complete sends the signer to /signer?prompt=login, which posts a fresh
    // assertion back, and the signer lands on the same document and completes.
    {
      const { envelopeId, recipients } = await seedEnvelope();
      const page = await freshPage(browser);
      const signUrl = `/sign/${recipients[0].token}`;

      await openThroughGate(
        page,
        await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId, authTime: now - 16 * 60 }),
      );
      await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

      const reauth = page.waitForRequest((req) => req.url().startsWith(`${identity.issuer}/signer?`));
      await completeAndSign(page);

      const reauthUrl = new URL((await reauth).url());
      expect(reauthUrl.searchParams.get('prompt')).toBe('login');
      expect(reauthUrl.searchParams.get('max_age')).toBe('0');
      expect(reauthUrl.searchParams.get('recipient')).toBe(String(recipients[0].id));

      await page.waitForURL(new RegExp(`${signUrl}$`));
      await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

      await completeAndSign(page);
      await page.waitForURL(new RegExp(`${signUrl}/complete$`));

      const verified = await prisma.documentAuditLog.count({
        where: { envelopeId, type: 'KERBWELL_IDENTITY_VERIFIED' },
      });
      expect(verified).toBe(2);
    }

    // 14 minutes: Complete goes straight through.
    {
      const { envelopeId, recipients } = await seedEnvelope();
      const page = await freshPage(browser);
      const signUrl = `/sign/${recipients[0].token}`;
      let reauthRequested = false;
      page.on('request', (req) => {
        if (req.url().startsWith(`${identity.issuer}/signer`)) {
          reauthRequested = true;
        }
      });

      await openThroughGate(
        page,
        await identity.mintAssertion({ recipientId: recipients[0].id, envelopeId, authTime: now - 14 * 60 }),
      );
      await completeAndSign(page);
      await page.waitForURL(new RegExp(`${signUrl}/complete$`));
      expect(reauthRequested).toBe(false);
    }
  });

  test('a recipient dispatched with KERBWELL_GATE access and action auth signs a field and completes', async ({
    browser,
  }) => {
    const { user, team } = await seedUser();
    const { document, recipients } = await seedPendingDocumentWithFullFields({
      owner: user,
      teamId: team.id,
      recipients: [`kw-gate-auth-${Date.now()}@example.com`],
      fields: [FieldType.SIGNATURE],
      recipientsCreateOptions: [
        {
          authOptions: createRecipientAuthOptions({ accessAuth: ['KERBWELL_GATE'], actionAuth: ['KERBWELL_GATE'] }),
        },
      ],
    });
    const [recipient] = recipients;
    const signUrl = `/sign/${recipient.token}`;

    const page = await freshPage(browser);
    await openThroughGate(page, await identity.mintAssertion({ recipientId: recipient.id, envelopeId: document.id }));
    await expect(page.getByRole('heading', { name: 'Sign Document' })).toBeVisible();

    await signSignaturePad(page);

    for (const field of recipient.fields) {
      await page.locator(`#field-${field.id}`).getByRole('button').click();
      await expect(page.locator(`#field-${field.id}`)).toHaveAttribute('data-inserted', 'true');
    }

    // No auth prompt: the gate cookie is the proof.
    await expect(page.getByText('Reauthentication is required')).toHaveCount(0);

    await completeAndSign(page);
    await page.waitForURL(new RegExp(`${signUrl}/complete$`));

    const signed = await prisma.recipient.findUniqueOrThrow({ where: { id: recipient.id } });
    expect(signed.signingStatus).toBe('SIGNED');
  });
});
