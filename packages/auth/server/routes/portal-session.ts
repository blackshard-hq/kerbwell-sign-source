import { AppError } from '@documenso/lib/errors/app-error';
import { isValidReturnTo, normalizeReturnTo } from '@documenso/lib/utils/is-valid-return-to';
import { prisma } from '@documenso/prisma';
import { createHmac, timingSafeEqual } from 'crypto';
import { Hono } from 'hono';

import { AuthenticationErrorCode } from '../lib/errors/error-codes';
import { onAuthorize } from '../lib/utils/authorizer';
import type { HonoAuthContext } from '../types/context';

/**
 * Black Shard fork: native portal-session auth.
 *
 * When the BS-OS portal and this deployment share a site (portal cookie
 * scoped to the parent domain), a signed-in portal member carries the
 * HMAC-signed `bs-upn` cookie:
 *
 *   value = `${upn}.${base64url(HMAC-SHA256(key, 'bs-upn:v1:' + upn))}`
 *
 * base64url contains no '.', so the LAST '.' is always the separator even
 * though the UPN itself contains dots. This endpoint verifies that cookie
 * and mints a session through onAuthorize, the same chokepoint as every
 * upstream sign-in path, so the disabled-account guard still applies.
 *
 * Gated hard behind two PROCESS ENV variables (a trust root must not be
 * flippable from database-driven config):
 *   PORTAL_TRUST=1          enables the endpoint (off = upstream behaviour)
 *   PORTAL_SESSION_KEY      the portal's BS_OS_COOKIE_SIGNING_KEY
 *
 * Existing users only - this endpoint NEVER signs up users.
 */

const PORTAL_SESSION_COOKIE_NAME = 'bs-upn';

// v2 cookies carry a 30-day absolute lifetime from iat.
const ABS_MAX_AGE_S = 60 * 60 * 24 * 30;

const macEq = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const computeMacV1 = (upn: string, key: string): string =>
  createHmac('sha256', key).update(`bs-upn:v1:${upn}`).digest('base64url');

const computeMacV2 = (upn: string, iat: number, sid: string, key: string): string =>
  createHmac('sha256', key).update(`bs-upn:v2:${upn}:${iat}:${sid}`).digest('base64url');

/**
 * Accept BOTH portal cookie formats (the portal now issues v2 by default):
 *   v2: `v2.${upn}.${iat}.${sid}.${mac}`  (30-day lifetime enforced)
 *   v1: `${upn}.${mac}`
 * base64url has no '.', iat is decimal, so v2's last three '.' fields are
 * always mac/sid/iat. Timing-safe compare; fails closed to null.
 *
 * v1 sunset (BS-A202): v1 never expires, so it is gated behind an explicit
 * `allowV1` flag that defaults OFF. The caller sources this from process env
 * PORTAL_ALLOW_V1_UPN ('1' = on), the same trust-root convention as
 * PORTAL_TRUST - never DB/config-driven.
 */
// BS-A422 (2026-09-11 hard cutover): per-service HKDF-derived subkey, message
// additionally binds the service name so a tag minted/verified for one
// service can never be replayed as valid for another. Must match the label
// cookie-sign.ts embeds for this service (DOWNSTREAM_SERVICES) and the name
// portal-session-key-sync.sh derives PORTAL_SESSION_KEY under (infra/esign/.env).
const SERVICE_NAME = 'esign';

const computeMacV3 = (service: string, upn: string, iat: number, sid: string, key: string): string =>
  createHmac('sha256', key).update(`bs-upn:v3:${service}:${upn}:${iat}:${sid}`).digest('base64url');

const verifyPortalUpn = (
  cookieValue: string | undefined | null,
  key: string | undefined,
  allowV1 = false,
): string | null => {
  if (!cookieValue || !key) {
    return null;
  }

  // v3 cookie (BS-A422): "v3.<iat>.<sid>.<svc1>:<tag1>,<svc2>:<tag2>,....<upn>"
  if (cookieValue.startsWith('v3.')) {
    const parts = cookieValue.split('.');
    if (parts.length < 5) {
      return null;
    }
    const iatStr = parts[1];
    const sid = parts[2];
    const tagBlob = parts[3];
    const upn = parts.slice(4).join('.');
    if (!upn || !sid || !tagBlob || !/^\d+$/.test(iatStr)) {
      return null;
    }
    const iat = Number(iatStr);
    if (!Number.isFinite(iat)) {
      return null;
    }
    if (ABS_MAX_AGE_S > 0 && Math.floor(Date.now() / 1000) - iat > ABS_MAX_AGE_S) {
      return null;
    }
    const entry = tagBlob.split(',').find((t) => t.startsWith(`${SERVICE_NAME}:`));
    if (!entry) {
      return null;
    }
    const tag = entry.slice(SERVICE_NAME.length + 1);
    if (!tag) {
      return null;
    }
    return macEq(tag, computeMacV3(SERVICE_NAME, upn, iat, sid, key)) ? upn : null;
  }

  if (cookieValue.startsWith('v2.')) {
    const parts = cookieValue.split('.');
    if (parts.length < 5) {
      return null;
    }
    const mac = parts.pop() as string;
    const sid = parts.pop() as string;
    const iatStr = parts.pop() as string;
    parts.shift();
    const upn = parts.join('.');
    if (!upn || !sid || !/^\d+$/.test(iatStr)) {
      return null;
    }
    const iat = Number(iatStr);
    if (!Number.isFinite(iat)) {
      return null;
    }
    if (ABS_MAX_AGE_S > 0 && Math.floor(Date.now() / 1000) - iat > ABS_MAX_AGE_S) {
      return null;
    }
    return macEq(mac, computeMacV2(upn, iat, sid, key)) ? upn : null;
  }

  // v1 legacy cookie: "<upn>.<mac>" - sunset behind allowV1 (BS-A202)
  if (!allowV1) {
    return null;
  }
  const separatorIndex = cookieValue.lastIndexOf('.');
  if (separatorIndex <= 0) {
    return null;
  }
  const upn = cookieValue.slice(0, separatorIndex);
  const givenMac = cookieValue.slice(separatorIndex + 1);
  return macEq(givenMac, computeMacV1(upn, key)) ? upn : null;
};

/**
 * Cookie-header lookup that URL-decodes when possible - Next.js cookie
 * setters percent-encode characters like '@' in the UPN.
 */
const readPortalCookieValue = (cookieHeader: string | undefined, cookieName: string): string | undefined => {
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookiePart of cookieHeader.split(';')) {
    const separatorIndex = cookiePart.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    if (cookiePart.slice(0, separatorIndex).trim() !== cookieName) {
      continue;
    }

    const value = cookiePart.slice(separatorIndex + 1).trim();

    if (value.length === 0) {
      continue;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
};

/**
 * Resolve the portal cookie to a local user id, or throw the same fail-closed
 * errors the POST endpoint returns. Shared by /authorize (fetch, JSON) and
 * /sso (top-level GET that redirects into the app for an embedded iframe).
 */
/**
 * Handoff tokens (2026-09-24, Kane: the mobile and desktop shells open eSign
 * in the system browser, which never holds the portal cookie). The portal
 * mints a v3 value with ONLY the esign tag and a fresh iat, carried once in
 * the /sso query as `bsu`. Verified with the same subkey as the cookie, but
 * accepted for HANDOFF_MAX_AGE_S only and never twice (sid replay set).
 */
const HANDOFF_MAX_AGE_S = 120;
const usedHandoffSids = new Map<string, number>();
const consumeHandoffSid = (sid: string, iat: number): boolean => {
  const now = Math.floor(Date.now() / 1000);
  for (const [k, exp] of usedHandoffSids) if (exp < now) usedHandoffSids.delete(k);
  if (usedHandoffSids.has(sid)) return false;
  usedHandoffSids.set(sid, iat + HANDOFF_MAX_AGE_S + 5);
  return true;
};
const verifyHandoffToken = (token: string | undefined | null, key: string | undefined): string | null => {
  if (!token || !key || !token.startsWith('v3.')) return null;
  const parts = token.split('.');
  if (parts.length < 5) return null;
  const iat = Number(parts[1]);
  const sid = parts[2];
  if (!Number.isFinite(iat) || !sid) return null;
  const age = Math.floor(Date.now() / 1000) - iat;
  if (age < -30 || age > HANDOFF_MAX_AGE_S) return null;
  const upn = verifyPortalUpn(token, key, false);
  if (!upn) return null;
  return consumeHandoffSid(sid, iat) ? upn : null;
};

const authorizeFromPortalCookie = async (
  cookieHeader: string | undefined,
  handoffToken?: string | null,
): Promise<number> => {
  if (process.env.PORTAL_TRUST !== '1') {
    throw new AppError(AuthenticationErrorCode.NotSetup, {
      message: 'Portal trust is not enabled',
      statusCode: 403,
    });
  }

  const portalSessionKey = process.env.PORTAL_SESSION_KEY;

  if (!portalSessionKey) {
    // Fail closed: trust enabled without a key verifies nothing.
    throw new AppError(AuthenticationErrorCode.NotSetup, {
      message: 'Portal session key is not configured',
      statusCode: 403,
    });
  }

  const upn =
    verifyPortalUpn(
      readPortalCookieValue(cookieHeader, PORTAL_SESSION_COOKIE_NAME),
      portalSessionKey,
      process.env.PORTAL_ALLOW_V1_UPN === '1',
    ) ?? verifyHandoffToken(handoffToken, portalSessionKey);

  if (!upn) {
    throw new AppError(AuthenticationErrorCode.Unauthorized, {
      message: 'Missing or invalid portal session',
      statusCode: 401,
    });
  }

  const user = await prisma.user.findFirst({
    where: {
      email: upn.toLowerCase(),
    },
  });

  if (!user) {
    // FORBIDDEN rather than not-found: a portal member who is not a member
    // of this deployment is a refusal, not a lookup fault.
    throw new AppError(AuthenticationErrorCode.Unauthorized, {
      message: 'User is not a member of this deployment',
      statusCode: 403,
    });
  }

  // If the user enrolled documenso's own 2FA, DO NOT bypass it. The credentials
  // sign-in validates the TOTP/backup code before issuing a session; minting
  // one here would skip that factor. Refuse to the normal sign-in, which
  // enforces 2FA. (Staff use portal Entra MFA and don't enrol fork 2FA, so this
  // only guards the opt-in case.)
  if (user.twoFactorEnabled) {
    throw new AppError(AuthenticationErrorCode.Unauthorized, {
      message: 'Two-factor authentication is required; use the sign-in page',
      statusCode: 403,
    });
  }

  return user.id;
};

export const portalSessionRoute = new Hono<HonoAuthContext>()
  .post('/authorize', async (c) => {
    const userId = await authorizeFromPortalCookie(c.req.header('cookie'));
    await onAuthorize({ userId }, c);
    return c.json({ ok: true });
  })
  /**
   * Top-level GET so the BS-OS portal can embed esign in an iframe and have
   * the user land signed in: mint the session from the bs-upn cookie, then
   * 302 into the app. If the cookie is absent/invalid the user falls through
   * to the normal sign-in page (?direct=1) rather than seeing an error.
   */
  .get('/sso', async (c) => {
    // 2026-09-24 (Kane: "this should auto auth from our portal"): the portal
    // and every signing email link deep into the app, so the SSO leg has to
    // land the user back where they were going. Same-origin paths only.
    const requested = c.req.query('redirectPath');
    const redirectPath = isValidReturnTo(requested) ? (normalizeReturnTo(requested) ?? '/') : '/';
    try {
      const userId = await authorizeFromPortalCookie(c.req.header('cookie'), c.req.query('bsu'));
      await onAuthorize({ userId }, c);
      return c.redirect(redirectPath);
    } catch {
      const fallback = redirectPath === '/' ? '' : `&returnTo=${encodeURIComponent(redirectPath)}`;
      return c.redirect(`/signin?direct=1${fallback}`);
    }
  });
