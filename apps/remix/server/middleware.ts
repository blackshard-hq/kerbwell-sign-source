import { AppDebugger } from '@documenso/lib/utils/debugger';
import type { Context, Next } from 'hono';
import { setCookie } from 'hono/cookie';

import { handleRedirects } from './redirects';

const debug = new AppDebugger('Middleware');

/**
 * Middleware for initial page loads.
 *
 * You won't be able to easily handle sequential page loads because they will be
 * called under `path.data`
 *
 * Example an initial page load would be `/documents` then if the user click templates
 * the path here would be `/templates.data`.
 */
export const appMiddleware = async (c: Context, next: Next) => {
  const { req } = c;
  const { path } = req;

  // Paths to ignore.
  if (nonPagePathRegex.test(path)) {
    return next();
  }

  // PRE-HANDLER CODE: Place code here to execute BEFORE the route handler runs.
  const redirectPath = await handleRedirects(c);

  if (redirectPath) {
    debug.log('Redirecting from', path);
    debug.log('Redirecting to', redirectPath);

    return c.redirect(redirectPath);
  }

  await next();

  // POST-HANDLER CODE: Place code here to execute AFTER the route handler completes.
  // This is useful for:
  // - Setting cookies
  // - Any operations that should happen after all route handlers but before sending the response

  debug.log('Path', path);

  const pathname = path.replace('.data', '');

  // Set the preferred team url cookie if user accesses a team page.
  if (pathname.startsWith('/t/')) {
    debug.log('Setting preferred team url cookie');

    setCookie(c, 'preferred-team-url', pathname.split('/')[2], {
      sameSite: 'lax',
    });

    return;
  }
};

// This regex matches any path that:
// 1. Starts with /api/, /ingest/, /__manifest/, or /assets/
// 2. Starts with /apple- (like /apple-touch-icon.png)
// 3. Starts with /favicon (like /favicon.ico)
// The ^ ensures matching from the beginning of the string
// The | acts as OR operator between different patterns
const nonPagePathRegex = /^(\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/apple-.*|\/favicon.*)/;

/**
 * Kerbwell: the document API answers only on the internal host.
 *
 * NEXT_PRIVATE_INTERNAL_API_HOSTS is a comma-separated list of host names (the container's
 * internal FQDN on the platform network). When it is set, /api/v1, /api/v2 and /api/v2-beta
 * return 404 to any request whose Host is not on the list, and to any request that came through
 * the public edge (it carries a Cloudflare header), whatever its Host says. The signing pages,
 * /api/health, /api/auth, /api/trpc (the signing UI) and the Kerbwell gate stay public. Unset or
 * empty, the lock is off and the API behaves as upstream.
 */
export const LOCKED_API_PATH_REGEX = /^\/api\/(v1|v2|v2-beta)(\/|$)/i;

const EDGE_HEADERS = ['cf-ray', 'cf-connecting-ip', 'cdn-loop'];

export const parseInternalApiHosts = (raw: string | undefined): Set<string> => {
  const hosts = new Set<string>();

  for (const entry of (raw ?? '').split(',')) {
    const host = normaliseHost(entry);

    if (host.length > 0) {
      hosts.add(host);
    }
  }

  return hosts;
};

/** Lowercase, no port, no trailing dot. IPv6 literals keep their brackets. */
export const normaliseHost = (value: string | undefined | null): string => {
  const host = (value ?? '').trim().toLowerCase();

  if (host.startsWith('[')) {
    const end = host.indexOf(']');

    return end > 0 ? host.slice(0, end + 1) : host;
  }

  return host.replace(/:\d+$/, '').replace(/\.+$/, '');
};

export const isApiRequestRefused = (options: {
  path: string;
  host: string | undefined | null;
  headers: { get(name: string): string | null | undefined };
  internalHosts: Set<string>;
}): boolean => {
  const { path, host, headers, internalHosts } = options;

  if (internalHosts.size === 0 || !LOCKED_API_PATH_REGEX.test(path)) {
    return false;
  }

  if (EDGE_HEADERS.some((name) => headers.get(name))) {
    return true;
  }

  return !internalHosts.has(normaliseHost(host));
};

export const createInternalApiHostLock = (internalHosts: Set<string>) => async (c: Context, next: Next) => {
  if (
    isApiRequestRefused({
      path: c.req.path,
      host: c.req.header('host'),
      headers: { get: (name) => c.req.header(name) },
      internalHosts,
    })
  ) {
    return c.json({ message: 'Not found' }, 404);
  }

  await next();
};

export const internalApiHostLock = createInternalApiHostLock(
  parseInternalApiHosts(process.env['NEXT_PRIVATE_INTERNAL_API_HOSTS']),
);
