/**
 * Kerbwell signer UI on a phone (K3): the AU disclosure, the typed signature from the CDD legal
 * name, no upload on an agency agreement, the "Something wrong?" actions, the done page, and
 * WCAG 2.2 AA on the signing page.
 *
 * Runs against a server with NEXT_PRIVATE_KERBWELL_GATE_ISSUER=<KERBWELL_E2E_GATE_ISSUER> (default
 * http://127.0.0.1:4455), which this spec serves with the K1 stand-in identity (fake-identity.ts).
 * Documents are seeded as v2 envelopes, the kind the Kerbwell dispatch creates through API v2.
 *
 * Skipped when KERBWELL_E2E_GATE_ISSUER is unset.
 */
import AxeBuilder from '@axe-core/playwright';
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { KERBWELL_DISCLOSURE_VERSION } from '@documenso/lib/constants/kerbwell-disclosure';
import { prisma } from '@documenso/prisma';
import { seedPendingDocumentWithFullFields } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import { type Browser, type BrowserContextOptions, expect, type Page, test } from '@playwright/test';
import { DocumentStatus, FieldType } from '@prisma/client';

import { FakeKerbwellIdentity } from '../kerbwell-gate/fake-identity';

const ENABLED = Boolean(process.env.KERBWELL_E2E_GATE_ISSUER);
const APP_URL = NEXT_PUBLIC_WEBAPP_URL();

const LEGAL_NAME = 'Jordan Example Citizen';

/** An iPhone 13 class phone, on Chromium (the browser CI installs). */
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

/** A 1x1 PNG, standing in for any image a caller uploads. */
const UPLOADED_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const STROKE: Array<[number, number]> = [
  [40, 120],
  [80, 90],
  [120, 130],
  [160, 80],
  [200, 140],
  [240, 70],
];

const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe.configure({ mode: 'serial' });

let identity: FakeKerbwellIdentity;

const seedEnvelope = async (options: { agentEmail?: string } = {}) => {
  const { user, team } = await seedUser();
  const email = `kw-k3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  const { document, recipients } = await seedPendingDocumentWithFullFields({
    owner: user,
    teamId: team.id,
    recipients: [email],
    fields: [FieldType.SIGNATURE],
    updateDocumentOptions: { status: DocumentStatus.PENDING, internalVersion: 2, title: 'Exclusive agency agreement' },
  });

  if (options.agentEmail) {
    await prisma.documentMeta.update({
      where: { id: document.documentMetaId },
      data: { emailReplyTo: options.agentEmail },
    });
  }

  return { envelopeId: document.id, recipient: recipients[0] };
};

const openPhone = async (
  browser: Browser,
  input: { docKind?: string; mode?: 'remote' | 'in_person'; agentEmail?: string } = {},
  context: BrowserContextOptions = PHONE,
) => {
  const { envelopeId, recipient } = await seedEnvelope({ agentEmail: input.agentEmail });
  const page = await (await browser.newContext(context)).newPage();

  const assertion = await identity.mintAssertion({
    recipientId: recipient.id,
    envelopeId,
    legalName: LEGAL_NAME,
    docKind: input.docKind ?? 'agency_agreement',
    mode: input.mode,
  });

  await page.goto(identity.postUrl(assertion));
  await page.waitForURL(new RegExp(`/sign/${recipient.token}$`));

  // The PDF page and its field layer are drawn.
  await expect(page.getByTestId('kw-field-target').first()).toBeAttached({ timeout: 30_000 });

  return { page, envelopeId, recipient };
};

/** One tap on the first signature field, at its box on the canvas. */
const tapSignatureField = async (page: Page) => {
  const target = page.locator('[data-testid="kw-field-target"][data-field-type="SIGNATURE"]').first();
  await target.scrollIntoViewIfNeeded();

  const box = await target.boundingBox();
  expect(box).not.toBeNull();

  if (!box) {
    return;
  }

  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};

test.describe('kerbwell signer UI', () => {
  test.skip(!ENABLED, 'KERBWELL_E2E_GATE_ISSUER is not set');

  test.beforeAll(async () => {
    identity = new FakeKerbwellIdentity(APP_URL);
    await identity.start();
  });

  test.afterAll(async () => {
    await identity?.stop();
  });

  test('the disclosure page carries the AU wording and its version, and no US law', async ({ browser }) => {
    const page = await (await browser.newContext(PHONE)).newPage();

    await page.goto('/articles/signature-disclosure');

    await expect(page.getByRole('heading', { name: 'Electronic signing disclosure and consent' })).toBeVisible();
    await expect(page.getByTestId('disclosure-version')).toContainText(KERBWELL_DISCLOSURE_VERSION);
    await expect(page.getByText('Electronic Transactions Act 1999 (Cth)').first()).toBeVisible();
    await expect(page.getByText('Electronic Transactions (Queensland) Act 2001')).toBeVisible();
    await expect(page.getByText(/E-Sign Act|Global and National Commerce/)).toHaveCount(0);

    const axe = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test('agency agreement: typed signature first, filled with the legal name; no upload', async ({ browser }) => {
    const { page } = await openPhone(browser, { docKind: 'agency_agreement' });

    await tapSignatureField(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('tab', { name: 'Type' })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByRole('tab', { name: 'Draw' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Upload' })).toHaveCount(0);
    await expect(dialog.getByTestId('signature-pad-type-input')).toHaveValue(LEGAL_NAME);
    await expect(dialog.getByRole('button', { name: 'Adopt signature' })).toBeEnabled();
  });

  test('general document: upload is offered, the typed name is still filled in', async ({ browser }) => {
    const { page } = await openPhone(browser, { docKind: 'general_non_prescribed' });

    await tapSignatureField(page);

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('tab', { name: 'Upload' })).toBeVisible();
    await expect(dialog.getByTestId('signature-pad-type-input')).toHaveValue(LEGAL_NAME);
  });

  test('agency agreement: the server refuses an uploaded image sent straight to the sign endpoint', async ({
    browser,
  }) => {
    const { page, recipient } = await openPhone(browser, { docKind: 'agency_agreement' });
    const field = await prisma.field.findFirstOrThrow({
      where: { recipientId: recipient.id, type: FieldType.SIGNATURE },
    });

    const sign = async (extra: Record<string, unknown>) =>
      await page.request.post('/api/trpc/envelope.field.sign?batch=1', {
        data: {
          0: {
            json: {
              token: recipient.token,
              fieldId: field.id,
              fieldValue: { type: FieldType.SIGNATURE, value: UPLOADED_IMAGE },
              ...extra,
            },
          },
        },
      });

    // An image with no strokes, as an upload would arrive: refused, nothing stored.
    const refused = await sign({});
    expect(refused.status()).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain('KERBWELL_UPLOAD_REFUSED');
    expect(await prisma.signature.count({ where: { fieldId: field.id } })).toBe(0);

    // With the pad's strokes the server stores its own render of them, never the image sent.
    const drawn = await sign({
      kerbwellDrawn: { width: 600, height: 200, color: 'black', lines: [STROKE] },
    });
    expect(drawn.status()).toBe(200);

    const stored = await prisma.signature.findFirstOrThrow({ where: { fieldId: field.id } });
    expect(stored.signatureImageAsBase64).toMatch(/^data:image\/png;base64,/);
    expect(stored.signatureImageAsBase64).not.toBe(UPLOADED_IMAGE);
  });

  test('agency agreement: a drawn signature is stored as the server render of its strokes', async ({ browser }) => {
    const { page, recipient } = await openPhone(
      browser,
      { docKind: 'agency_agreement' },
      { ...PHONE, hasTouch: false },
    );

    // The keyboard path opens the field (no touch screen in this context, so the mouse can draw).
    await page.locator('[data-testid="kw-field-target"][data-field-type="SIGNATURE"]').first().focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Draw' }).click();

    const pad = dialog.getByTestId('signature-pad-draw');
    const box = await pad.boundingBox();
    expect(box).not.toBeNull();

    if (!box) {
      return;
    }

    await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(box.x + 30 + i * 20, box.y + box.height * (i % 2 ? 0.3 : 0.7), { steps: 4 });
    }
    await page.mouse.up();

    await dialog.getByRole('button', { name: 'Adopt signature' }).click();
    await expect(dialog).toHaveCount(0);

    const field = await prisma.field.findFirstOrThrow({
      where: { recipientId: recipient.id, type: FieldType.SIGNATURE },
      include: { signature: true },
    });

    await expect
      .poll(async () => (await prisma.field.findUniqueOrThrow({ where: { id: field.id } })).inserted)
      .toBe(true);

    const signature = await prisma.signature.findFirstOrThrow({ where: { fieldId: field.id } });
    expect(signature.signatureImageAsBase64).toMatch(/^data:image\/png;base64,/);
    expect(signature.typedSignature).toBeNull();
  });

  test('general document: the server takes an uploaded image as it is', async ({ browser }) => {
    const { page, recipient } = await openPhone(browser, { docKind: 'general_non_prescribed' });
    const field = await prisma.field.findFirstOrThrow({
      where: { recipientId: recipient.id, type: FieldType.SIGNATURE },
    });

    const res = await page.request.post('/api/trpc/envelope.field.sign?batch=1', {
      data: {
        0: {
          json: {
            token: recipient.token,
            fieldId: field.id,
            fieldValue: { type: FieldType.SIGNATURE, value: UPLOADED_IMAGE },
          },
        },
      },
    });
    expect(res.status()).toBe(200);

    const stored = await prisma.signature.findFirstOrThrow({ where: { fieldId: field.id } });
    expect(stored.signatureImageAsBase64).toBe(UPLOADED_IMAGE);
  });

  test('the first page arrives as a server image in the HTML and is the largest paint', async ({ browser }) => {
    const { page, recipient } = await openPhone(browser);

    // The server-rendered HTML already holds the poster, so it does not wait for the bundle.
    const pageResponse = await page.request.get(`/sign/${recipient.token}`);
    const html = await pageResponse.text();
    const posterPath = /src="([^"]*\/page-1\.webp)"/.exec(html)?.[1]?.replaceAll('&amp;', '&');
    expect(posterPath).toBeTruthy();

    // The response also names it in a preload header, ahead of the page's module preloads.
    const link = /<([^>]+\/page-1\.webp)>; rel=preload; as=image; fetchpriority=high/.exec(
      pageResponse.headers()['link'] ?? '',
    );
    expect(link).not.toBeNull();
    expect(new URL(posterPath ?? '', APP_URL).pathname).toBe(link?.[1]);

    const poster = await page.request.get(posterPath ?? '');
    expect(poster.status()).toBe(200);
    expect(poster.headers()['content-type']).toBe('image/webp');
    expect(poster.headers()['cache-control']).toContain('private');

    // Without the gate session the image is refused like the PDF beside it.
    const stranger = await (await browser.newContext()).request.get(posterPath ?? '');
    expect(stranger.status()).toBe(403);

    const lcp = await page.evaluate(
      async () =>
        await new Promise<string>((resolve) => {
          // The entry's url names the image even after the viewer has replaced the poster.
          new PerformanceObserver((list) => {
            const last = list.getEntries().at(-1) as PerformanceEntry & { url?: string };
            resolve(last?.url ?? '');
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        }),
    );
    expect(lcp).toMatch(/\/page-1\.webp$/);
  });

  test('phone: 16px inputs, no zoom on focus, nothing wider than the screen at 320 px', async ({ browser }) => {
    const { page } = await openPhone(browser);

    // An input under 16px makes iOS zoom on focus. Every text input on the page and in the
    // signature dialog is 16px or more on a touch screen.
    await page.getByRole('button', { name: 'Show signing details' }).click();

    const fontSizes = await page
      .locator('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea')
      .evaluateAll((els) =>
        els.filter((el) => el.getClientRects().length > 0).map((el) => getComputedStyle(el).fontSize),
      );

    expect(fontSizes.length).toBeGreaterThan(0);

    for (const size of fontSizes) {
      expect(Number.parseFloat(size)).toBeGreaterThanOrEqual(16);
    }

    // The page scale stays 1 after focusing the name field (no zoom).
    await page.getByLabel('Full Name').locator('visible=true').first().focus();
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

    // 320 px reflow (WCAG 1.4.10): no horizontal scroll.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.goto('/articles/signature-disclosure');
    const disclosureOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(disclosureOverflow).toBeLessThanOrEqual(0);
  });

  test('Next field brings the field into view above the signing bar and focuses it; Enter opens it', async ({
    browser,
  }) => {
    const { page } = await openPhone(browser);

    // Scroll the document away first, so Next field has to bring the field back.
    await page.locator('.embed--DocumentContainer').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));

    await page.getByRole('button', { name: 'Next field' }).click();

    const target = page.locator('[data-testid="kw-field-target"][data-field-type="SIGNATURE"]').first();
    await expect(target).toBeFocused();

    // Not hidden by the fixed signing bar (WCAG 2.4.11), and inside the visual viewport.
    await expect
      .poll(async () => {
        const field = await target.boundingBox();
        const bar = await page.locator('.fixed.bottom-0').first().boundingBox();
        const viewportHeight = await page.evaluate(() => window.visualViewport?.height ?? window.innerHeight);

        if (!field || !bar) {
          return false;
        }

        return field.y >= 0 && field.y + field.height <= Math.min(bar.y, viewportHeight);
      })
      .toBe(true);

    // The keyboard path (WCAG 2.1.1, 2.5.7): Enter on the focused field opens it, no tap or drag.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog').getByTestId('signature-pad-type-input')).toHaveValue(LEGAL_NAME);
  });

  test('axe WCAG 2.2 AA: the signing page and the signature dialog have no violations', async ({ browser }) => {
    const { page } = await openPhone(browser, { agentEmail: 'agent@blackshard.com.au' });

    // pdf.js text layers and the canvas are third-party rendering of the document itself.
    const axe = await new AxeBuilder({ page }).withTags(WCAG_22_AA).exclude('.react-pdf__Page__textContent').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

    await tapSignatureField(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    const axeDialog = await new AxeBuilder({ page }).withTags(WCAG_22_AA).include('[role="dialog"]').analyze();
    expect(axeDialog.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
      [],
    );
  });

  test('Something wrong? is on screen with the gate actions', async ({ browser }) => {
    const { page, envelopeId } = await openPhone(browser, { agentEmail: 'agent@blackshard.com.au' });

    await expect(page.getByTestId('kw-something-wrong')).toBeVisible();
    await page.getByTestId('kw-something-wrong').click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: 'Ask the agent' })).toHaveAttribute(
      'href',
      /^mailto:agent@blackshard\.com\.au\?subject=/,
    );
    await expect(dialog.getByRole('button', { name: 'Decline with a reason' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'I am the wrong person' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Request paper' })).toBeVisible();

    // Request paper pauses: it explains that nothing is signed and offers a prefilled email. It
    // never opens the decline, so the envelope stays open (the disclosure's "Paper instead").
    await dialog.getByRole('button', { name: 'Request paper' }).click();
    const paper = page.getByTestId('kw-pause-paper');
    await expect(paper).toContainText('Electronic signing is paused for you.');
    await expect(paper.getByRole('link', { name: 'Email the agent' })).toHaveAttribute(
      'href',
      /^mailto:agent@blackshard\.com\.au\?subject=Paper%20copy%20requested/,
    );
    await expect(page.getByRole('textbox', { name: 'Reason' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(paper).toHaveCount(0);

    // Wrong person does not decline for the right person either.
    if (!(await page.getByRole('button', { name: 'I am the wrong person' }).isVisible())) {
      await page.getByTestId('kw-something-wrong').click();
    }
    await page.getByRole('button', { name: 'I am the wrong person' }).click();
    const wrong = page.getByTestId('kw-pause-wrong-person');
    await expect(wrong).toContainText('Do not sign this document.');
    await expect(wrong.getByRole('link', { name: 'Email the agent' })).toHaveAttribute(
      'href',
      /^mailto:agent@blackshard\.com\.au\?subject=Wrong%20person/,
    );
    await expect(page.getByRole('textbox', { name: 'Reason' })).toHaveCount(0);

    const envelope = await prisma.envelope.findUniqueOrThrow({ where: { id: envelopeId } });
    expect(envelope.status).toBe(DocumentStatus.PENDING);
  });

  test('Request paper without an agent email still pauses and names who to contact', async ({ browser }) => {
    const { page, envelopeId } = await openPhone(browser);

    await page.getByTestId('kw-something-wrong').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Request paper' }).click();

    const paper = page.getByTestId('kw-pause-paper');
    await expect(paper).toContainText('Contact the agent who sent you this document.');
    await expect(paper.getByRole('link')).toHaveCount(0);

    const envelope = await prisma.envelope.findUniqueOrThrow({ where: { id: envelopeId } });
    expect(envelope.status).toBe(DocumentStatus.PENDING);
  });

  test('an internal signer completes in four taps, and the done page offers the copy and a passkey', async ({
    browser,
  }) => {
    const { page, recipient } = await openPhone(browser);

    let taps = 0;

    // 1: the signature field. 2: adopt the typed legal name.
    await tapSignatureField(page);
    taps++;
    await page.getByRole('button', { name: 'Adopt signature' }).tap();
    taps++;

    // 3: Complete. 4: Sign agreement, beside the binding line.
    await page.getByRole('button', { name: 'Complete' }).tap();
    taps++;

    const confirm = page.getByRole('dialog');
    await expect(confirm.getByTestId('sign-agreement-line')).toHaveText(
      'By tapping Sign agreement I sign this document and agree to be bound by it.',
    );
    await confirm.getByRole('button', { name: 'Sign agreement' }).tap();
    taps++;

    await page.waitForURL(new RegExp(`/sign/${recipient.token}/complete$`));
    expect(taps).toBe(4);

    const signed = await prisma.field.findFirstOrThrow({
      where: { recipientId: recipient.id, type: FieldType.SIGNATURE },
      include: { signature: true },
    });
    expect(signed.inserted).toBe(true);
    expect(signed.signature?.typedSignature).toBe(LEGAL_NAME);

    await expect(page.getByTestId('kw-done-copy')).toContainText(
      'The executed PDF is emailed to every party when everyone has signed.',
    );
    await expect(page.getByRole('button', { name: 'Download current copy' })).toBeVisible();
    await expect(page.getByTestId('kw-passkey-offer')).toHaveAttribute(
      'href',
      new RegExp(`/signer/passkey\\?recipient=${recipient.id}&envelope=`),
    );
  });

  test('kiosk mode: no passkey offer on the done page', async ({ browser }) => {
    const { page, recipient } = await openPhone(browser, { mode: 'in_person' });

    await tapSignatureField(page);
    await page.getByRole('button', { name: 'Adopt signature' }).tap();
    await page.getByRole('button', { name: 'Complete' }).tap();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign agreement' }).tap();

    await page.waitForURL(new RegExp(`/sign/${recipient.token}/complete$`));
    await expect(page.getByTestId('kw-done-copy')).toBeVisible();
    await expect(page.getByTestId('kw-passkey-offer')).toHaveCount(0);
  });
});
