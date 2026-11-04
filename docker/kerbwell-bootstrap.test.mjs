#!/usr/bin/env node
/**
 * kerbwell-bootstrap.test.mjs: the bootstrap against a fresh, migrated database.
 *
 * Runs inside the eSign image (it imports the server build, as the bootstrap does), from
 * /app/apps/remix, with NEXT_PRIVATE_DATABASE_URL pointing at an empty database that
 * prisma-migrate-deploy.mjs has just migrated. docker/kerbwell-bootstrap.test.sh sets that up.
 *
 *     node --test kerbwell-bootstrap.test.mjs
 *
 * It runs the job twice and checks the second run changes nothing, then reads the rows back.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const HERE = new URL('.', import.meta.url).pathname;
const SERVER_ROOT = process.env.KERBWELL_ESIGN_SERVER_ROOT || join(HERE, 'build/server/hono');

const WEBHOOK_SECRET = randomBytes(24).toString('hex');
const ENV = {
  KERBWELL_ESIGN_ADMIN_EMAIL: 'esign-admin@blackshard.com.au',
  KERBWELL_ESIGN_ADMIN_PASSWORD: randomBytes(18).toString('base64url'),
  KERBWELL_ESIGN_WEBHOOK_URL:
    'https://kerbwell-staff.internal.test.australiaeast.azurecontainerapps.io/api/integrations/esign/webhook',
  KERBWELL_ESIGN_WEBHOOK_SECRET: WEBHOOK_SECRET,
  KERBWELL_ESIGN_TOKEN: `api_${randomBytes(16).toString('hex')}`,
  KERBWELL_ESIGN_BOOTSTRAP_QUIET: '1',
};

const WANT_TRIGGERS = [
  'DOCUMENT_CREATED',
  'DOCUMENT_SENT',
  'DOCUMENT_OPENED',
  'DOCUMENT_SIGNED',
  'DOCUMENT_RECIPIENT_COMPLETED',
  'DOCUMENT_COMPLETED',
  'DOCUMENT_REJECTED',
  'DOCUMENT_CANCELLED',
  'RECIPIENT_EXPIRED',
];

let prisma;
let bootstrap;

before(async () => {
  Object.assign(process.env, ENV);
  ({ prisma } = await import(pathToFileURL(join(SERVER_ROOT, 'packages/prisma/index.js')).href));
  bootstrap = await import(pathToFileURL(join(HERE, 'kerbwell-bootstrap.mjs')).href);

  const users = await prisma.user.count();
  assert.equal(users, 0, 'the test needs a fresh database (no users)');
});

after(async () => {
  await prisma?.$disconnect();
});

test('first run on a fresh database succeeds, second run is idempotent', async () => {
  assert.equal(await bootstrap.main(), 0);

  const snapshot = async () => ({
    webhooks: await prisma.webhook.findMany({ orderBy: { id: 'asc' } }),
    settings: await prisma.organisationGlobalSettings.findMany(),
    claims: await prisma.organisationClaim.findMany(),
    tokens: await prisma.apiToken.findMany({ select: { id: true, token: true } }),
  });

  const first = await snapshot();
  assert.equal(await bootstrap.main(), 0);
  const second = await snapshot();

  assert.deepEqual(second, first);
});

test('the webhook carries the full trigger set, the env URL and the secret', async () => {
  const webhooks = await prisma.webhook.findMany();

  assert.equal(webhooks.length, 1);
  const [webhook] = webhooks;
  assert.equal(webhook.webhookUrl, ENV.KERBWELL_ESIGN_WEBHOOK_URL);
  assert.equal(webhook.secret, WEBHOOK_SECRET);
  assert.equal(webhook.enabled, true);
  assert.deepEqual([...webhook.eventTriggers].sort(), [...WANT_TRIGGERS].sort());
  assert.deepEqual([...bootstrap.EVENT_TRIGGERS].sort(), [...WANT_TRIGGERS].sort());
});

test('organisation defaults: audit log and certificate on, 14-day expiry, emails off', async () => {
  const org = await prisma.organisation.findFirstOrThrow({
    where: { url: 'kerbwell' },
    include: {
      organisationGlobalSettings: true,
      organisationClaim: true,
      teams: { include: { teamGlobalSettings: true } },
    },
  });
  const settings = org.organisationGlobalSettings;

  assert.equal(settings.includeAuditLog, true);
  assert.equal(settings.includeSigningCertificate, true);
  assert.deepEqual(settings.envelopeExpirationPeriod, { unit: 'day', amount: 14 });
  assert.ok(Object.values(settings.emailDocumentSettings).every((v) => v === false));

  // The team inherits (null) or matches.
  const team = org.teams.find((t) => t.url === 'kerbwell');
  assert.ok(team);
  for (const key of ['includeAuditLog', 'includeSigningCertificate']) {
    assert.ok(team.teamGlobalSettings[key] === null || team.teamGlobalSettings[key] === true, key);
  }

  // The fork's own resolver gives 14 days for a new envelope in this team.
  const { resolveExpiresAt } = await import(
    pathToFileURL(join(SERVER_ROOT, 'packages/lib/constants/envelope-expiration.js')).href
  );
  const expiresAt = resolveExpiresAt(settings.envelopeExpirationPeriod);
  const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 13.99 && days <= 14, `expiry ${days} days`);

  // Claim flags our fork needs.
  for (const [key, value] of Object.entries(bootstrap.KERBWELL_CLAIM_FLAGS)) {
    assert.equal(org.organisationClaim.flags[key], value, key);
  }
  assert.equal(org.organisationClaim.flags.cfr21, true);
});

test('moving the webhook URL replaces the old row instead of adding a second', async () => {
  process.env.KERBWELL_ESIGN_WEBHOOK_URL =
    'https://kerbwell-staff.internal.test2.australiaeast.azurecontainerapps.io/api/integrations/esign/webhook';
  try {
    assert.equal(await bootstrap.main(), 0);
    const webhooks = await prisma.webhook.findMany();
    assert.equal(webhooks.length, 1);
    assert.equal(webhooks[0].webhookUrl, process.env.KERBWELL_ESIGN_WEBHOOK_URL);
  } finally {
    process.env.KERBWELL_ESIGN_WEBHOOK_URL = ENV.KERBWELL_ESIGN_WEBHOOK_URL;
  }
});
