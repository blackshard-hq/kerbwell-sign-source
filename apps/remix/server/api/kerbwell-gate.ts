import {
  checkKerbwellGateForToken,
  getKerbwellGateConfig,
  getKerbwellPosterPreloadPath,
  KerbwellAssertionError,
  KerbwellGateRefusedError,
  kerbwellPosterLinkHeader,
  openKerbwellGateSession,
  runWithKerbwellGateRequest,
  serializeKerbwellGateCookie,
  verifyKerbwellAssertion,
} from '@documenso/lib/server-only/kerbwell-gate';
import { logger } from '@documenso/lib/utils/logger';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { HonoEnv } from '../router';

/**
 * Kerbwell gate (fork addition, Kerbwell Sign).
 *
 * Kerbwell Identity verifies the signer on a second channel, then sends the browser here with an
 * auto-submitted top-level POST carrying the signer assertion. This route checks it, opens a gate
 * session for that one recipient, sets __Host-kw_gate and 303s to /sign/{token}. The Documenso
 * token never travels through Kerbwell's messages: the redirect is built from the recipient row.
 *
 * kerbwellGatePageGuard then refuses every recipient-token surface (the signing pages and their
 * data requests, the PDF file routes, the embed and report pages) without that cookie, and
 * kerbwellGateRequestStore makes the request's cookie readable to isRecipientAuthorized.
 */

export const KERBWELL_LINK_INACTIVE_PATH = '/link-inactive';

const RETRY_PATH = `${KERBWELL_LINK_INACTIVE_PATH}?reason=retry`;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const;

export const kerbwellGateRoute = new Hono<HonoEnv>().post('/gate', async (c) => {
  const config = getKerbwellGateConfig();

  if (!config) {
    return c.notFound();
  }

  // The post comes from the identity service's page (top-level form). A browser always sends
  // Origin on a POST; any other site's page is refused.
  const origin = c.req.header('Origin');
  const selfOrigin = new URL(c.req.url).origin;

  if (origin && origin !== new URL(config.issuer).origin && origin !== selfOrigin) {
    return c.text('Forbidden', 403, NO_STORE_HEADERS);
  }

  const contentType = c.req.header('Content-Type') ?? '';

  if (!contentType.startsWith('application/x-www-form-urlencoded') && !contentType.startsWith('multipart/form-data')) {
    return c.text('Unsupported Media Type', 415, NO_STORE_HEADERS);
  }

  const body = await c.req.parseBody().catch(() => null);
  const assertion = body && typeof body.assertion === 'string' ? body.assertion : null;

  const requestLogger = c.get('logger') ?? logger;

  if (!assertion) {
    return c.redirect(RETRY_PATH, 303);
  }

  try {
    const claims = await verifyKerbwellAssertion({ assertion, config });

    const { handle, recipientToken } = await openKerbwellGateSession({
      claims,
      requestMetadata: c.get('context').requestMetadata,
    });

    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
      c.header(key, value);
    }

    c.header('Set-Cookie', serializeKerbwellGateCookie(handle));

    return c.redirect(`/sign/${encodeURIComponent(recipientToken)}`, 303);
  } catch (err) {
    if (err instanceof KerbwellAssertionError || err instanceof KerbwellGateRefusedError) {
      requestLogger.warn({ msg: 'kerbwell gate refused an assertion', reason: err.reason });

      for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
        c.header(key, value);
      }

      return c.redirect(RETRY_PATH, 303);
    }

    throw err;
  }
});

/**
 * Runs the request with its Cookie header in the gate request store (packages/lib
 * server-only/kerbwell-gate/request-store.ts).
 */
export const kerbwellGateRequestStore = createMiddleware<HonoEnv>(async (c, next) =>
  runWithKerbwellGateRequest(c.req.header('cookie') ?? null, () => next()),
);

type GuardedSurface = {
  token: string | null;
  /** Where a refused page view goes. Data and file requests get 403 instead. */
  inactivePath: string;
  isPage: boolean;
};

const SIGN_INDEX_PATH_REGEX = /^\/sign\/[^/.]+\/?$/;
const SIGN_PATH_REGEX = /^\/sign\/([^/]+?)(\.data)?(?:\/([^/]+?)(\.data)?)?\/?$/;
const EMBED_SIGN_PATH_REGEX = /^\/embed\/sign\/([^/]+?)(\.data)?\/?$/;
const REPORT_PATH_REGEX = /^\/report\/([^/]+?)(\.data)?\/?$/;
const FILE_TOKEN_PATH_REGEX = /^\/api\/files\/token\/([^/]+)\//;
const DIRECT_LINK_PATH_REGEX = /^\/(d|embed\/direct)\/[^/]+?(\.data)?(\/|$)/;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/**
 * Which recipient-token surface a path is, if any. Direct template links come back with a null
 * token: they have no recipient to gate.
 */
export const classifyKerbwellGatePath = (path: string): GuardedSurface | null => {
  const sign = SIGN_PATH_REGEX.exec(path);

  if (sign) {
    const token = safeDecode(sign[1]);
    const child = sign[3];

    // The inactive page itself is open, or a refused visitor could never see it.
    if (child === 'inactive') {
      return null;
    }

    return {
      token,
      inactivePath: token ? `/sign/${encodeURIComponent(token)}/inactive` : KERBWELL_LINK_INACTIVE_PATH,
      isPage: !sign[2] && !sign[4],
    };
  }

  const embed = EMBED_SIGN_PATH_REGEX.exec(path) ?? REPORT_PATH_REGEX.exec(path);

  if (embed) {
    const token = safeDecode(embed[1]);

    return {
      token,
      inactivePath: token ? `/sign/${encodeURIComponent(token)}/inactive` : KERBWELL_LINK_INACTIVE_PATH,
      isPage: !embed[2],
    };
  }

  const file = FILE_TOKEN_PATH_REGEX.exec(path);

  if (file) {
    const token = safeDecode(file[1]);

    // qr_ tokens are the completion certificate's verification link, not a recipient.
    if (token?.startsWith('qr_')) {
      return null;
    }

    return { token, inactivePath: KERBWELL_LINK_INACTIVE_PATH, isPage: false };
  }

  const direct = DIRECT_LINK_PATH_REGEX.exec(path);

  if (direct) {
    return { token: null, inactivePath: KERBWELL_LINK_INACTIVE_PATH, isPage: !direct[2] };
  }

  return null;
};

export const kerbwellGatePageGuard = createMiddleware<HonoEnv>(async (c, next) => {
  const config = getKerbwellGateConfig();

  if (!config) {
    return next();
  }

  const surface = classifyKerbwellGatePath(c.req.path);

  if (!surface) {
    return next();
  }

  const refuse = () => {
    if (surface.isPage && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
      c.header('Cache-Control', 'no-store');
      c.header('Referrer-Policy', 'no-referrer');

      return c.redirect(surface.inactivePath, 303);
    }

    return c.json({ error: 'This link is no longer active.' }, 403, NO_STORE_HEADERS);
  };

  // Direct template links: under mode `all` nobody reaches a document without a gate session,
  // and a direct link has no recipient to hold one.
  if (surface.token === null) {
    return config.mode === 'all' ? refuse() : next();
  }

  const check = await checkKerbwellGateForToken({
    token: surface.token,
    cookieHeader: c.req.header('cookie'),
  });

  if (check.status === 'refused') {
    return refuse();
  }

  // The signing page: tell the browser about the first-page image before it reads the HTML, so
  // the page's largest paint does not queue behind the page's scripts (or rides a 103 Early Hint
  // where the edge sends one).
  if (check.status === 'allowed' && c.req.method === 'GET' && SIGN_INDEX_PATH_REGEX.test(c.req.path)) {
    await next();

    if (c.res.status === 200 && c.res.headers.get('content-type')?.startsWith('text/html')) {
      const poster = await getKerbwellPosterPreloadPath(check.recipientId, surface.token).catch(() => null);

      if (poster) {
        c.res.headers.append('Link', kerbwellPosterLinkHeader(poster));
      }
    }

    return;
  }

  return next();
});
