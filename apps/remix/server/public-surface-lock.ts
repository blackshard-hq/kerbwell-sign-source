import type { Context, Next } from 'hono';

import { isFromPublicEdge, normaliseHost, parseInternalApiHosts } from './middleware';

/**
 * Kerbwell: no public sign-in or dashboard.
 *
 * KERBWELL_PUBLIC_SIGNIN_REDIRECT is an absolute https URL (Kerbwell: https://app.kerbwell.com.au).
 * When it is set, every page request on a public host gets a 302 to that URL, except the paths
 * signers, the client portal embed and the platform need (PUBLIC_PATH_REGEX): the signing and
 * direct-link pages, the embeds, shared and reported documents, the signature disclosure, the
 * internal PDF render, the whole of /api (which keeps its own host lock), the built assets, the
 * static files, /.well-known and the web manifest. Everything else, including /, /signin,
 * /signup, /forgot-password, /reset-password, the dashboard, settings, admin and unknown paths,
 * redirects. The list is of what stays open, so a route added upstream is closed until it is
 * named here.
 *
 * A request is internal, and passes untouched, when its Host is one of
 * NEXT_PRIVATE_INTERNAL_API_HOSTS and it carries no Cloudflare edge header (the same rule as the
 * API host lock). That is how the platform administrator reaches sign-in and the dashboard.
 *
 * A value that is not an absolute http(s) URL keeps the lock on and answers 404 instead of
 * redirecting, so a typo never reopens the sign-in page. Unset or empty, the lock is off and the
 * app behaves as upstream (the estate instance does not set it).
 */
export const PUBLIC_PATH_REGEX = new RegExp(
  [
    '^/(api|assets|static|fonts|\\.well-known|sign|d|embed|share|report|articles|__htmltopdf|ingest)(/|$)',
    '^/__manifest$',
    '^/(favicon[^/]*|apple-[^/]*|android-chrome-[^/]*|robots\\.txt|opengraph-image\\.jpg|site\\.webmanifest)$',
  ].join('|'),
);

export type SigninRedirect = { kind: 'off' } | { kind: 'redirect'; url: string } | { kind: 'invalid' };

export const parseSigninRedirect = (raw: string | undefined): SigninRedirect => {
  const value = (raw ?? '').trim();

  if (value.length === 0) {
    return { kind: 'off' };
  }

  try {
    const url = new URL(value);

    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return { kind: 'invalid' };
    }

    return { kind: 'redirect', url: url.toString() };
  } catch {
    return { kind: 'invalid' };
  }
};

export const isPublicSurfacePath = (path: string): boolean => PUBLIC_PATH_REGEX.test(path);

/** What the lock does with one request: pass it on, or answer it. */
export const publicSurfaceDecision = (options: {
  path: string;
  host: string | undefined | null;
  headers: { get(name: string): string | null | undefined };
  internalHosts: Set<string>;
  redirect: SigninRedirect;
}): { action: 'pass' } | { action: 'redirect'; url: string } | { action: 'not-found' } => {
  const { path, host, headers, internalHosts, redirect } = options;

  if (redirect.kind === 'off' || isPublicSurfacePath(path)) {
    return { action: 'pass' };
  }

  if (internalHosts.has(normaliseHost(host)) && !isFromPublicEdge(headers)) {
    return { action: 'pass' };
  }

  return redirect.kind === 'redirect' ? { action: 'redirect', url: redirect.url } : { action: 'not-found' };
};

export const createPublicSurfaceLock = (internalHosts: Set<string>, redirect: SigninRedirect) => {
  if (redirect.kind === 'invalid') {
    console.error(
      'KERBWELL_PUBLIC_SIGNIN_REDIRECT is not an absolute http(s) URL: the public surface lock answers 404',
    );
  }

  return async (c: Context, next: Next) => {
    const decision = publicSurfaceDecision({
      path: c.req.path,
      host: c.req.header('host'),
      headers: { get: (name) => c.req.header(name) },
      internalHosts,
      redirect,
    });

    if (decision.action === 'pass') {
      await next();
      return;
    }

    c.header('Cache-Control', 'no-store');

    if (decision.action === 'redirect') {
      return c.redirect(decision.url, 302);
    }

    return c.text('Not found', 404);
  };
};

export const publicSurfaceLock = createPublicSurfaceLock(
  parseInternalApiHosts(process.env['NEXT_PRIVATE_INTERNAL_API_HOSTS']),
  parseSigninRedirect(process.env['KERBWELL_PUBLIC_SIGNIN_REDIRECT']),
);
