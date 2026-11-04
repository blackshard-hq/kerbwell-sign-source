#!/usr/bin/env node
/**
 * kerbwell-bootstrap.mjs: make a fresh signing instance ready for Kerbwell's API client.
 *
 * Runs inside the eSign image (an ACA job on the same image and database as the app), from
 * /app/apps/remix, as:
 *
 *     node kerbwell-bootstrap.mjs
 *
 * IDEMPOTENT. Every step reads before it writes and a second run changes nothing it does not
 * need to. A run that finds the API token already made does not make another one (the
 * plaintext of an existing token cannot be recovered; set KERBWELL_ESIGN_ROTATE_TOKEN=1 to
 * replace it).
 *
 * THE FORK'S OWN CODE DOES THE WORK. The server build keeps one file per source module
 * (rollup preserveModules), so the job imports the same createOrganisation, createTeam,
 * createApiToken and createWebhook the app runs, the same Prisma client, and hashes the admin
 * password with the same bcrypt and SALT_ROUNDS as the app's sign-up. Nothing here re-states
 * how an organisation, a team or a token is made.
 *
 * STEPS
 *   1. Admin user: KERBWELL_ESIGN_ADMIN_EMAIL, password KERBWELL_ESIGN_ADMIN_PASSWORD (a Key
 *      Vault secret reference on the job), email verified, roles ADMIN and USER. An existing
 *      user keeps its row; the password hash is replaced only when the password no longer
 *      matches it. No personal organisation is made for this user.
 *   2. Organisation 'Kerbwell' (url kerbwell) owned by that user, on the free claim, the same
 *      claim the admin panel gives an organisation it creates.
 *   3. Team 'Kerbwell' (url kerbwell) in that organisation.
 *   4. API token 'realsaas-kerbwell' for that team, no expiry. THE PLAINTEXT IS NEVER PRINTED.
 *      Preferred (ACA): the operator generates the token (api_ followed by 16 or more of a-z and
 *      0-9), stores it in Key Vault, and the job reads it as KERBWELL_ESIGN_TOKEN (a secret
 *      reference). The job stores its hash, the same sha512 the fork's createApiToken stores, and
 *      removes every other token of that name, so rotating is: new value in Key Vault, rerun.
 *      Otherwise the fork issues the token and the plaintext goes only to the file
 *      KERBWELL_ESIGN_TOKEN_OUT (mode 0600). With neither set the job refuses (exit 2): a token
 *      printed to stdout lands in the platform's log store.
 *   5. Webhook to KERBWELL_ESIGN_WEBHOOK_URL (the staff app's internal https FQDN on the
 *      platform network) with secret KERBWELL_ESIGN_WEBHOOK_SECRET, enabled, on every envelope
 *      event Kerbwell records: DOCUMENT_CREATED, SENT, OPENED, SIGNED (one recipient signed),
 *      RECIPIENT_COMPLETED, COMPLETED, REJECTED, CANCELLED and RECIPIENT_EXPIRED. A webhook in
 *      the team that carries the same secret on another URL is an earlier target of this job
 *      and is removed, so moving the URL never delivers twice.
 *   6. Organisation claim flags Kerbwell's fork uses (KERBWELL_CLAIM_FLAGS below): recipient
 *      action auth (the flag upstream calls cfr21, which the Kerbwell gate needs), custom
 *      branding and no upstream "powered by" line. The code these flags switch on is the
 *      AGPL code in packages/lib; nothing in packages/ee is used, and its stubs stay severed.
 *   7. Organisation defaults: every document email off (Kerbwell delivers signing links through
 *      its own portal and comms rail); the signing certificate and the audit log appended to
 *      every completed PDF; envelopes expire 14 days after sending; and the recipient-page
 *      branding from KERBWELL_ESIGN_BRANDING_* when set, mirroring infra/esign/branding/apply.py
 *      (read back after write).
 *
 * Exit 0 when every step holds, 1 on a failed step, 2 on missing or bad configuration.
 * Secrets never appear in the output.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = process.env.KERBWELL_ESIGN_SERVER_ROOT || join(HERE, 'build/server/hono');

/**
 * Every envelope event Kerbwell records. DOCUMENT_SIGNED is the fork's per-recipient "signed"
 * event (complete-document-with-token.ts fires it each time one recipient signs); the fork has
 * no separate RECIPIENT_SIGNED trigger.
 */
export const EVENT_TRIGGERS = [
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

/** Signing certificate and audit log on every completed PDF; 14-day envelope expiry. */
export const DOCUMENT_DEFAULTS = {
  includeSigningCertificate: true,
  includeAuditLog: true,
  envelopeExpirationPeriod: { unit: 'day', amount: 14 },
};

/**
 * Claim flags set on the Kerbwell organisation (lib/types/subscription.ts ZClaimFlagsSchema).
 * Merged into whatever the claim already holds; nothing else in the claim is changed.
 */
export const KERBWELL_CLAIM_FLAGS = {
  cfr21: true,
  allowCustomBranding: true,
  hidePoweredBy: true,
  unlimitedDocuments: true,
};

/** Every document email the fork can send, off (packages/lib/types/document-email.ts). */
const EMAIL_SETTINGS_OFF = {
  recipientSigningRequest: false,
  recipientRemoved: false,
  recipientSigned: false,
  documentPending: false,
  documentCompleted: false,
  documentDeleted: false,
  ownerDocumentCompleted: false,
  ownerRecipientExpired: false,
  ownerDocumentCreated: false,
};

const log = (message) => {
  if (process.env.KERBWELL_ESIGN_BOOTSTRAP_QUIET !== '1') {
    process.stdout.write(`[kerbwell-bootstrap] ${message}\n`);
  }
};

class ConfigError extends Error {}

const optional = (key, fallback) => {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
};

const required = (key) => {
  const value = optional(key, undefined);
  if (value === undefined) {
    throw new ConfigError(`${key} is not set`);
  }
  return value;
};

/** A module of the fork's server build, by its source path under packages/. */
const fork = (sourcePath) =>
  import(
    pathToFileURL(join(process.env.KERBWELL_ESIGN_SERVER_ROOT || SERVER_ROOT, 'packages', `${sourcePath}.js`)).href
  );

export const readConfig = () => {
  const config = {
    adminEmail: required('KERBWELL_ESIGN_ADMIN_EMAIL').toLowerCase(),
    adminPassword: required('KERBWELL_ESIGN_ADMIN_PASSWORD'),
    adminName: optional('KERBWELL_ESIGN_ADMIN_NAME', 'Kerbwell Sign administrator'),
    orgName: optional('KERBWELL_ESIGN_ORG_NAME', 'Kerbwell'),
    orgUrl: optional('KERBWELL_ESIGN_ORG_URL', 'kerbwell'),
    teamName: optional('KERBWELL_ESIGN_TEAM_NAME', 'Kerbwell'),
    teamUrl: optional('KERBWELL_ESIGN_TEAM_URL', 'kerbwell'),
    tokenName: optional('KERBWELL_ESIGN_TOKEN_NAME', 'realsaas-kerbwell'),
    tokenValue: optional('KERBWELL_ESIGN_TOKEN', undefined),
    tokenOut: optional('KERBWELL_ESIGN_TOKEN_OUT', undefined),
    rotateToken: optional('KERBWELL_ESIGN_ROTATE_TOKEN', '0') === '1',
    webhookUrl: required('KERBWELL_ESIGN_WEBHOOK_URL'),
    webhookSecret: required('KERBWELL_ESIGN_WEBHOOK_SECRET'),
    branding: {
      url: optional('KERBWELL_ESIGN_BRANDING_URL', undefined),
      companyDetails: optional('KERBWELL_ESIGN_BRANDING_COMPANY_DETAILS', undefined),
      colors: optional('KERBWELL_ESIGN_BRANDING_COLORS', undefined),
      css: optional('KERBWELL_ESIGN_BRANDING_CSS', undefined),
      logoFile: optional('KERBWELL_ESIGN_BRANDING_LOGO_FILE', undefined),
    },
  };

  if (config.adminPassword.length < 12) {
    throw new ConfigError('KERBWELL_ESIGN_ADMIN_PASSWORD is shorter than 12 characters');
  }
  if (config.tokenValue !== undefined && !/^api_[a-z0-9]{16,64}$/.test(config.tokenValue)) {
    throw new ConfigError('KERBWELL_ESIGN_TOKEN must be api_ followed by 16 to 64 of a-z and 0-9');
  }
  if (config.tokenValue === undefined && config.tokenOut === undefined) {
    throw new ConfigError(
      'set KERBWELL_ESIGN_TOKEN (the token, from Key Vault) or KERBWELL_ESIGN_TOKEN_OUT (a file); the token is never printed',
    );
  }
  if (config.webhookSecret.length < 16) {
    throw new ConfigError('KERBWELL_ESIGN_WEBHOOK_SECRET is shorter than 16 characters');
  }
  let webhook;
  try {
    webhook = new URL(config.webhookUrl);
  } catch {
    throw new ConfigError('KERBWELL_ESIGN_WEBHOOK_URL is not a URL');
  }
  if (webhook.protocol !== 'https:' && optional('KERBWELL_ESIGN_ALLOW_HTTP_WEBHOOK', '0') !== '1') {
    throw new ConfigError(
      'KERBWELL_ESIGN_WEBHOOK_URL must be https (KERBWELL_ESIGN_ALLOW_HTTP_WEBHOOK=1 for a scratch run)',
    );
  }
  for (const [key, value] of [
    ['KERBWELL_ESIGN_ORG_URL', config.orgUrl],
    ['KERBWELL_ESIGN_TEAM_URL', config.teamUrl],
  ]) {
    if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(value)) {
      throw new ConfigError(`${key} must be 2 to 48 of a-z, 0-9 and -`);
    }
  }
  if (config.branding.colors !== undefined) {
    let colors;
    try {
      colors = JSON.parse(config.branding.colors);
    } catch {
      throw new ConfigError('KERBWELL_ESIGN_BRANDING_COLORS is not JSON');
    }
    if (colors === null || typeof colors !== 'object' || Array.isArray(colors)) {
      throw new ConfigError('KERBWELL_ESIGN_BRANDING_COLORS must be a JSON object of token to colour');
    }
    for (const [token, value] of Object.entries(colors)) {
      if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
        throw new ConfigError(`KERBWELL_ESIGN_BRANDING_COLORS.${token} must be a #RRGGBB colour`);
      }
    }
    config.branding.colors = colors;
  }

  return config;
};

async function ensureAdmin(prisma, config) {
  const { hash, compare } = await import('@node-rs/bcrypt');
  const { SALT_ROUNDS } = await fork('lib/constants/auth');

  const existing = await prisma.user.findFirst({ where: { email: config.adminEmail } });

  if (existing === null) {
    const user = await prisma.user.create({
      data: {
        name: config.adminName,
        email: config.adminEmail,
        password: await hash(config.adminPassword, SALT_ROUNDS),
        emailVerified: new Date(),
        roles: ['ADMIN', 'USER'],
      },
    });
    log(`admin user created (id ${user.id})`);
    return user;
  }

  const data = {};
  if (existing.password === null || !(await compare(config.adminPassword, existing.password))) {
    data.password = await hash(config.adminPassword, SALT_ROUNDS);
  }
  if (existing.emailVerified === null) {
    data.emailVerified = new Date();
  }
  if (!existing.roles.includes('ADMIN') || !existing.roles.includes('USER')) {
    data.roles = Array.from(new Set([...existing.roles, 'ADMIN', 'USER']));
  }
  if (existing.disabled) {
    data.disabled = false;
  }

  if (Object.keys(data).length === 0) {
    log(`admin user present (id ${existing.id}), unchanged`);
    return existing;
  }

  const user = await prisma.user.update({ where: { id: existing.id }, data });
  log(`admin user present (id ${user.id}), updated: ${Object.keys(data).join(', ')}`);
  return user;
}

async function ensureOrganisation(prisma, config, user) {
  const existing = await prisma.organisation.findFirst({ where: { url: config.orgUrl } });

  if (existing !== null) {
    if (existing.ownerUserId !== user.id) {
      throw new Error(`organisation url ${config.orgUrl} exists and belongs to another user`);
    }
    log(`organisation present (${existing.id}), unchanged`);
    return existing;
  }

  const { createOrganisation } = await fork('lib/server-only/organisation/create-organisation');
  const { getSubscriptionClaim } = await fork('lib/server-only/subscription/get-subscription-claim');
  const { INTERNAL_CLAIM_ID } = await fork('lib/types/subscription');

  const organisation = await createOrganisation({
    userId: user.id,
    name: config.orgName,
    url: config.orgUrl,
    type: 'ORGANISATION',
    claim: await getSubscriptionClaim(INTERNAL_CLAIM_ID.FREE),
  });
  log(`organisation created (${organisation.id})`);
  return organisation;
}

async function ensureTeam(prisma, config, user, organisation) {
  const existing = await prisma.team.findFirst({ where: { url: config.teamUrl } });

  if (existing !== null) {
    if (existing.organisationId !== organisation.id) {
      throw new Error(`team url ${config.teamUrl} exists in another organisation`);
    }
    log(`team present (id ${existing.id}), unchanged`);
    return existing;
  }

  const { createTeam } = await fork('lib/server-only/team/create-team');

  await createTeam({
    userId: user.id,
    teamName: config.teamName,
    teamUrl: config.teamUrl,
    organisationId: organisation.id,
    inheritMembers: true,
  });

  const team = await prisma.team.findFirstOrThrow({ where: { url: config.teamUrl } });
  log(`team created (id ${team.id})`);
  return team;
}

async function ensureToken(prisma, config, user, team) {
  const existing = await prisma.apiToken.findMany({ where: { teamId: team.id, name: config.tokenName } });

  if (config.tokenValue !== undefined) {
    const { hashString } = await fork('lib/server-only/auth/hash');
    const hashed = hashString(config.tokenValue);
    const current = existing.find((t) => t.token === hashed);
    const stale = existing.filter((t) => t.token !== hashed);

    let keptId;
    if (current !== undefined) {
      keptId = current.id;
    } else {
      const { buildTeamWhereQuery } = await fork('lib/utils/teams');
      const { TEAM_MEMBER_ROLE_PERMISSIONS_MAP } = await fork('lib/constants/teams');
      // The permission check createApiToken makes: the admin must be able to manage the team.
      const allowed = await prisma.team.findFirst({
        where: buildTeamWhereQuery({
          teamId: team.id,
          userId: user.id,
          roles: TEAM_MEMBER_ROLE_PERMISSIONS_MAP.MANAGE_TEAM,
        }),
      });
      if (allowed === null) {
        throw new Error(`admin user ${user.id} cannot manage team ${team.id}; no token stored`);
      }
      const created = await prisma.apiToken.create({
        data: { name: config.tokenName, token: hashed, expires: null, userId: user.id, teamId: team.id },
      });
      keptId = created.id;
      log(`api token '${config.tokenName}' stored from KERBWELL_ESIGN_TOKEN (id ${created.id})`);
    }

    // The old tokens go only once the current one exists, so a failed rotation leaves the client working.
    if (stale.length > 0) {
      await prisma.apiToken.deleteMany({ where: { id: { in: stale.map((t) => t.id) } } });
      log(
        `api token '${config.tokenName}': ${stale.length} other token(s) removed (id ${stale.map((t) => t.id).join(', ')})`,
      );
    }
    if (current !== undefined && stale.length === 0) {
      log(`api token '${config.tokenName}' present (id ${keptId}), matches KERBWELL_ESIGN_TOKEN, unchanged`);
    }
    return;
  }

  if (existing.length > 0 && !config.rotateToken) {
    log(`api token '${config.tokenName}' present (id ${existing.map((t) => t.id).join(', ')}), not reissued`);
    return;
  }

  const { createApiToken } = await fork('lib/server-only/public-api/create-api-token');
  const created = await createApiToken({
    userId: user.id,
    teamId: team.id,
    tokenName: config.tokenName,
    expiresIn: null,
  });

  // Written before the old token goes, so a failed write leaves the client working.
  writeFileSync(config.tokenOut, `${created.token}\n`, { mode: 0o600 });
  log(`api token written to ${config.tokenOut}`);

  if (existing.length > 0) {
    await prisma.apiToken.deleteMany({ where: { id: { in: existing.map((t) => t.id) } } });
    log(`api token '${config.tokenName}' rotated (old id ${existing.map((t) => t.id).join(', ')} removed)`);
  } else {
    log(`api token '${config.tokenName}' created (id ${created.id})`);
  }
}

async function ensureWebhook(prisma, config, user, team) {
  const matches = await prisma.webhook.findMany({ where: { teamId: team.id, webhookUrl: config.webhookUrl } });
  const want = { eventTriggers: EVENT_TRIGGERS, secret: config.webhookSecret, enabled: true };

  if (matches.length === 0) {
    const { createWebhook } = await fork('lib/server-only/webhooks/create-webhook');
    const webhook = await createWebhook({ webhookUrl: config.webhookUrl, userId: user.id, teamId: team.id, ...want });
    log(`webhook created (${webhook.id})`);
    return;
  }

  const [keep, ...extra] = matches;
  const same =
    keep.enabled &&
    keep.secret === config.webhookSecret &&
    keep.eventTriggers.length === EVENT_TRIGGERS.length &&
    EVENT_TRIGGERS.every((t) => keep.eventTriggers.includes(t));

  if (!same) {
    await prisma.webhook.update({ where: { id: keep.id }, data: want });
    log(`webhook present (${keep.id}), updated`);
  } else {
    log(`webhook present (${keep.id}), unchanged`);
  }

  // Two rows on one URL would deliver every event twice.
  if (extra.length > 0) {
    await prisma.webhook.deleteMany({ where: { id: { in: extra.map((w) => w.id) } } });
    log(`removed ${extra.length} duplicate webhook row(s) on the same url`);
  }
}

/** A webhook on another URL with this job's secret is an earlier target: remove it. */
async function removeMovedWebhooks(prisma, config, team) {
  const moved = await prisma.webhook.findMany({
    where: { teamId: team.id, secret: config.webhookSecret, NOT: { webhookUrl: config.webhookUrl } },
    select: { id: true },
  });

  if (moved.length > 0) {
    await prisma.webhook.deleteMany({ where: { id: { in: moved.map((w) => w.id) } } });
    log(`removed ${moved.length} webhook row(s) left on an earlier url`);
  }
}

async function ensureClaimFlags(prisma, organisation) {
  const org = await prisma.organisation.findUniqueOrThrow({
    where: { id: organisation.id },
    select: { organisationClaimId: true },
  });
  const claim = await prisma.organisationClaim.findUniqueOrThrow({ where: { id: org.organisationClaimId } });
  const current = claim.flags !== null && typeof claim.flags === 'object' ? claim.flags : {};
  const missing = Object.entries(KERBWELL_CLAIM_FLAGS).filter(([key, value]) => current[key] !== value);

  if (missing.length === 0) {
    log('organisation claim flags unchanged');
    return;
  }

  await prisma.organisationClaim.update({
    where: { id: claim.id },
    data: { flags: { ...current, ...KERBWELL_CLAIM_FLAGS } },
  });

  const after = await prisma.organisationClaim.findUniqueOrThrow({ where: { id: claim.id } });
  const left = Object.entries(KERBWELL_CLAIM_FLAGS).filter(([key, value]) => after.flags?.[key] !== value);
  if (left.length > 0) {
    throw new Error(`organisation claim flags read back differ on: ${left.map(([k]) => k).join(', ')}`);
  }
  log(`organisation claim flags set and read back: ${missing.map(([k]) => k).join(', ')}`);
}

/** JSON with object keys sorted: jsonb stores keys in its own order, so a plain stringify differs. */
const canonical = (value) =>
  JSON.stringify(value, (_key, v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

function brandingWant(config, current) {
  const want = { emailDocumentSettings: EMAIL_SETTINGS_OFF, ...DOCUMENT_DEFAULTS };
  const b = config.branding;
  const anyBranding = Object.values(b).some((v) => v !== undefined);

  if (anyBranding) {
    want.brandingEnabled = true;
  }
  if (b.url !== undefined) {
    want.brandingUrl = b.url;
  }
  if (b.companyDetails !== undefined) {
    want.brandingCompanyDetails = b.companyDetails.replace(/\\n/g, '\n');
  }
  if (b.colors !== undefined) {
    want.brandingColors = b.colors;
  }
  if (b.css !== undefined) {
    want.brandingCss = b.css;
  }
  if (b.logoFile !== undefined) {
    const bytes = readFileSync(b.logoFile);
    if (bytes.subarray(0, 4).toString('latin1') !== '\x89PNG') {
      throw new ConfigError('KERBWELL_ESIGN_BRANDING_LOGO_FILE is not a PNG');
    }
    want.brandingLogo = JSON.stringify({ type: 'BYTES_64', data: bytes.toString('base64') });
  }

  const changed = Object.keys(want).filter((key) => {
    if (key === 'brandingLogo') {
      try {
        return JSON.stringify(JSON.parse(current.brandingLogo || 'null')) !== want.brandingLogo;
      } catch {
        return true;
      }
    }
    return canonical(current[key] ?? null) !== canonical(want[key]);
  });

  return { want, changed };
}

async function ensureOrganisationSettings(prisma, config, organisation) {
  const settingsId = organisation.organisationGlobalSettingsId;
  const current = await prisma.organisationGlobalSettings.findUniqueOrThrow({ where: { id: settingsId } });
  const { want, changed } = brandingWant(config, current);

  if (changed.length === 0) {
    log('organisation settings unchanged');
    return;
  }

  const data = Object.fromEntries(changed.map((key) => [key, want[key]]));
  await prisma.organisationGlobalSettings.update({ where: { id: settingsId }, data });

  const after = await prisma.organisationGlobalSettings.findUniqueOrThrow({ where: { id: settingsId } });
  const left = brandingWant(config, after).changed;
  if (left.length > 0) {
    throw new Error(`organisation settings read back differ on: ${left.join(', ')}`);
  }
  log(`organisation settings updated and read back: ${changed.join(', ')}`);
}

/** A team-level override of a document default would win over the organisation: align it. */
async function ensureTeamDefaults(prisma, team) {
  const settings = await prisma.teamGlobalSettings.findUniqueOrThrow({ where: { id: team.teamGlobalSettingsId } });
  const data = Object.fromEntries(
    Object.entries(DOCUMENT_DEFAULTS).filter(
      ([key, value]) => settings[key] !== null && canonical(settings[key]) !== canonical(value),
    ),
  );

  if (Object.keys(data).length === 0) {
    log('team settings inherit the organisation defaults');
    return;
  }

  await prisma.teamGlobalSettings.update({ where: { id: settings.id }, data });
  log(`team settings aligned with the organisation defaults: ${Object.keys(data).join(', ')}`);
}

export async function main() {
  let config;
  try {
    config = readConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      log(`configuration: ${error.message}`);
      return 2;
    }
    throw error;
  }

  // The app's own client (packages/prisma/index.ts in the bundle), not a second one.
  const { prisma } = await fork('prisma/index');

  try {
    const user = await ensureAdmin(prisma, config);
    const organisation = await ensureOrganisation(prisma, config, user);
    const team = await ensureTeam(prisma, config, user, organisation);
    await ensureToken(prisma, config, user, team);
    await ensureWebhook(prisma, config, user, team);
    await removeMovedWebhooks(prisma, config, team);
    await ensureClaimFlags(prisma, organisation);
    await ensureOrganisationSettings(prisma, config, organisation);
    await ensureTeamDefaults(prisma, team);
    log(`ready: organisation ${organisation.id}, team ${team.id}`);
    return 0;
  } catch (error) {
    if (error instanceof ConfigError) {
      log(`configuration: ${error.message}`);
      return 2;
    }
    log(`failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
