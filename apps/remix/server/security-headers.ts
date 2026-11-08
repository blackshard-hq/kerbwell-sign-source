import { createMiddleware } from 'hono/factory';

import type { HonoEnv } from './router';

/**
 * Paths that never render HTML and therefore do not need security headers.
 *
 * Browsers ignore CSP and friends on non-document responses, so we skip
 * them to keep API/manifest/asset responses clean.
 */
const NON_PAGE_PATH_REGEX = /^(\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/apple-.*|\/favicon.*)/;

/**
 * Embed routes serve our white-label embed UI. Customers iframe these from
 * arbitrary origins, so `frame-ancestors` must be wildcard, and customer-
 * supplied CSS is injected at runtime as `<style>` elements which means
 * `style-src-elem` cannot be nonce-restricted on these routes.
 */
const EMBED_PATH_REGEX = /^\/embed(\/|\.data|$)/;

/**
 * Non-`/embed` page routes that customers iframe directly, plus the auth
 * pages reachable from inside an embed iframe during the
 * reauth-as-different-account flow.
 *
 * Signing routes (`/sign/:token`, `/d/:token`):
 * Some customer integrations embed these URLs directly (without going
 * through `EmbedSignDocument`). Without `frame-ancestors *` here, those
 * integrations break with a "refused to connect" iframe error.
 *
 * Auth routes (`/signin`, `/forgot-password`, `/check-email`,
 * `/unverified-account`):
 * `apps/remix/app/components/general/document-signing/document-signing-auth-account.tsx`
 * does `window.location.href = '/signin?...'` inside the iframe when the
 * user needs to sign out and sign back in as a different account, and
 * `<SignInForm>` links/navigates to `/forgot-password`, `/check-email`, and
 * `/unverified-account` from there. Without `frame-ancestors *` on these
 * routes, the customer's iframe gets blocked the moment the user clicks
 * "Login" in the reauth dialog.
 *
 * These routes still get the strict nonced `script-src`/`style-src-elem`
 * policy — only `frame-ancestors` is relaxed. The `(\/|\.data|$)` tail
 * keeps `/sign` from matching `/signin`/`/signup` and `/d` from matching
 * `/dashboard`.
 */
const FRAMEABLE_PATH_REGEX = /^\/(signin|forgot-password|check-email|unverified-account|sign|d)(\/|\.data|$)/;

/**
 * Recipient signing pages (fork addition, Kerbwell Sign): `/sign/:token`, `/d/:token` and the
 * link-inactive page. Always `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, so the
 * token in the URL never leaves in a Referer and no shared cache keeps a signer's page.
 *
 * NEXT_PRIVATE_CSP_SIGN_FRAME_ANCESTORS: space-separated https origins allowed to frame them (for
 * Kerbwell, `https://client.kerbwell.com.au`). With the Kerbwell gate on and this unset, they can
 * be framed by this origin only. With both unset, they follow NEXT_PRIVATE_CSP_FRAME_ANCESTORS.
 */
const SIGNING_PATH_REGEX = /^\/(sign|d|link-inactive)(\/|\.data|$)/;

export const signingFrameAncestors = (env: NodeJS.ProcessEnv = process.env): string[] | null => {
  const configured = frameAncestorOrigins(env.NEXT_PRIVATE_CSP_SIGN_FRAME_ANCESTORS);

  if (configured !== null) {
    return configured;
  }

  return env.NEXT_PRIVATE_KERBWELL_GATE_ISSUER?.trim() ? [] : null;
};

/**
 * Hono context variable name where the per-request CSP nonce is stashed.
 *
 * Read by `getLoadContext` (server/load-context.ts) so the nonce can be
 * threaded into React Router's `<ServerRouter nonce>` and surfaced in the
 * root loader for use by `<Scripts>`, `<Links>`, etc.
 */
export const CSP_NONCE_KEY = 'cspNonce' as const;

const generateNonce = () => {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);

  let binary = '';

  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }

  return btoa(binary);
};

type CspPathKind = 'embed' | 'frameable' | 'signing' | 'default';

/**
 * Instance hardening, read from the environment (fork addition, Kerbwell Sign).
 *
 * NEXT_PRIVATE_CSP_FRAME_ANCESTORS: space-separated https origins allowed to frame the embed,
 * signing and auth routes. Set, those routes get `frame-ancestors 'self' <origins>` instead of
 * the upstream wildcard, so an instance whose only embedder is its own portal cannot be framed by
 * any other site. Anything that is not a bare https origin is dropped. Unset keeps upstream.
 *
 * NEXT_PRIVATE_HSTS: the Strict-Transport-Security value (e.g. `max-age=63072000;
 * includeSubDomains`), sent on every response. For an instance with no TLS-terminating proxy in
 * front that adds it. Unset sends none, as upstream.
 *
 * X-Content-Type-Options nosniff goes on every response, and X-Frame-Options SAMEORIGIN on the
 * pages that are not frameable at all (older browsers that ignore frame-ancestors).
 */
const ORIGIN_REGEX = /^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/;

export const frameAncestorOrigins = (raw: string | undefined = process.env.NEXT_PRIVATE_CSP_FRAME_ANCESTORS) => {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }

  return raw
    .trim()
    .split(/\s+/)
    .map((o) => o.toLowerCase().replace(/\/+$/, ''))
    .filter((o) => ORIGIN_REGEX.test(o));
};

const hstsValue = () => {
  const v = process.env.NEXT_PRIVATE_HSTS;

  return typeof v === 'string' && /^max-age=[0-9]+(;\s*includeSubDomains)?(;\s*preload)?$/.test(v.trim())
    ? v.trim()
    : null;
};

const buildCspHeader = ({ nonce, kind }: { nonce: string; kind: CspPathKind }) => {
  // `'self'` is included alongside `'strict-dynamic'` as a fallback for
  // browsers that don't understand `'strict-dynamic'`. Modern browsers
  // ignore `'self'` (and other host/scheme sources) when `'strict-dynamic'`
  // is present.
  const directives = [
    `base-uri 'self'`,
    `object-src 'none'`,
    `form-action 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // PDF.js (apps/remix/app/components/general/pdf-viewer/pdf-viewer.tsx)
    // creates a Web Worker via `new Worker(url)`. `'strict-dynamic'` does
    // not reliably propagate to worker creation across browsers, and
    // without `worker-src` the browser falls back to `script-src` which
    // would block the worker. `blob:` covers libs that inline workers.
    `worker-src 'self' blob:`,
    // Inline `style=""` attributes cannot be nonced or hashed (CSP3 has no
    // mechanism for it), and React inline styles, framer-motion, react-rnd,
    // konva, etc. all rely on them. `'unsafe-inline'` for attributes is
    // industry standard and does not weaken `style-src-elem`.
    `style-src-attr 'unsafe-inline'`,
  ];

  // Embeds inject customer-supplied CSS via runtime-created `<style>`
  // elements (see apps/remix/app/utils/css-vars.ts). Nonce-stamping those
  // would be brittle for white-label customers, so we accept
  // `'unsafe-inline'` on the embed scope only. Frameable (auth/signing)
  // pages do NOT load customer CSS and keep the strict nonced policy.
  if (kind === 'embed') {
    directives.push(`style-src-elem 'self' 'unsafe-inline'`);
  } else {
    directives.push(`style-src-elem 'self' 'nonce-${nonce}'`);
  }

  // Embed, signing, and auth routes are all reachable from inside a
  // customer's iframe and therefore need `frame-ancestors *`. Every other
  // page gets clickjacking protection.
  const signingAllowed = kind === 'signing' ? signingFrameAncestors() : null;

  if (signingAllowed !== null) {
    directives.push(['frame-ancestors', `'self'`, ...signingAllowed].join(' '));
  } else if (kind === 'embed' || kind === 'frameable' || kind === 'signing') {
    const allowed = frameAncestorOrigins();

    directives.push(allowed === null ? `frame-ancestors *` : ['frame-ancestors', `'self'`, ...allowed].join(' '));
  } else {
    directives.push(`frame-ancestors 'self'`);
  }

  return directives.join('; ');
};

const classifyPath = (path: string): CspPathKind => {
  if (EMBED_PATH_REGEX.test(path)) {
    return 'embed';
  }

  if (SIGNING_PATH_REGEX.test(path)) {
    return 'signing';
  }

  if (FRAMEABLE_PATH_REGEX.test(path)) {
    return 'frameable';
  }

  return 'default';
};

/**
 * Owns response security headers for page responses:
 * `Content-Security-Policy`, plus `Referrer-Policy` and
 * `X-Content-Type-Options` on embed routes (preserved from the per-route
 * `headers()` export this middleware replaces).
 *
 * Generates a per-request CSP nonce and stashes it on the Hono context so
 * `getLoadContext` (server/load-context.ts) can thread it into React
 * Router for `<ServerRouter nonce>` and `<Scripts nonce>` etc.
 *
 * Path-aware classification:
 * - `embed`     — wildcard `frame-ancestors`, `'unsafe-inline'`
 *                 style-src-elem (white-label CSS injection), strict
 *                 nonced script-src.
 * - `frameable` — wildcard `frame-ancestors` only; needed because the
 *                 embed reauth flow redirects the iframe to `/signin` etc,
 *                 and because some customers iframe `/sign/:token` and
 *                 `/d/:token` directly without using `EmbedSignDocument`.
 *                 Strict nonced script-src and style-src-elem otherwise.
 * - default     — strict nonced script-src and style-src-elem,
 *                 `frame-ancestors 'self'` for clickjacking protection.
 */
export const securityHeadersMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  const nonce = generateNonce();

  c.set(CSP_NONCE_KEY, nonce);

  await next();

  const path = c.req.path;

  const hsts = hstsValue();

  if (hsts !== null) {
    c.res.headers.set('Strict-Transport-Security', hsts);
  }

  if (!c.res.headers.has('X-Content-Type-Options')) {
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
  }

  if (NON_PAGE_PATH_REGEX.test(path)) {
    return;
  }

  const kind = classifyPath(path);

  c.res.headers.set('Content-Security-Policy', buildCspHeader({ nonce, kind }));

  if (kind === 'default' && !c.res.headers.has('X-Frame-Options')) {
    c.res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  }

  if (kind === 'signing') {
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    c.res.headers.set('Cache-Control', 'no-store');
  }

  // Preserved from the per-route `headers()` export in
  // apps/remix/app/routes/embed+/_v0+/_layout.tsx, which has been removed.
  if (kind === 'embed') {
    if (!c.res.headers.has('Referrer-Policy')) {
      c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }

    if (!c.res.headers.has('X-Content-Type-Options')) {
      c.res.headers.set('X-Content-Type-Options', 'nosniff');
    }
  }
});
