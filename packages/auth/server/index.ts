import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { isKerbwellAdminOidcOnly } from '@documenso/lib/constants/auth';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { extractRequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { setCsrfCookie } from './lib/session/session-cookies';
import { accountRoute } from './routes/account';
import { callbackRoute } from './routes/callback';
import { emailPasswordRoute } from './routes/email-password';
import { oauthRoute } from './routes/oauth';
import { passkeyRoute } from './routes/passkey';
import { sessionRoute } from './routes/session';
import { signOutRoute } from './routes/sign-out';
import { twoFactorRoute } from './routes/two-factor';
import type { HonoAuthContext } from './types/context';

/**
 * Sign-in routes closed under the Kerbwell admin lockdown: email and password (sign-in, sign-up,
 * reset, verification), the built-in passkey sign-in, Google, Microsoft and organisation SSO.
 * /oauth/authorize/oidc and /callback/oidc stay open. Signed-in account management (two-factor,
 * passkey management through tRPC) is untouched.
 */
const KERBWELL_ADMIN_CLOSED_PATH_REGEX =
  /\/api\/auth\/(email-password\/|passkey\/authorize|oauth\/authorize\/(google|microsoft|oidc\/org\/)|callback\/(google|microsoft|oidc\/org\/))/;

// Note: You must chain routes for Hono RPC client to work.
export const auth = new Hono<HonoAuthContext>()
  .use(async (c, next) => {
    c.set('requestMetadata', extractRequestMetadata(c.req.raw));

    const validOrigin = new URL(NEXT_PUBLIC_WEBAPP_URL()).origin;
    const headerOrigin = c.req.header('Origin');

    if (headerOrigin && headerOrigin !== validOrigin) {
      return c.json(
        {
          message: 'Forbidden',
          statusCode: 403,
        },
        403,
      );
    }

    await next();
  })
  .use(async (c, next) => {
    // Kerbwell Sign admin lockdown: OIDC against Kerbwell Identity is the only way in
    // (packages/lib constants/auth.ts isKerbwellAdminOidcOnly).
    if (isKerbwellAdminOidcOnly() && KERBWELL_ADMIN_CLOSED_PATH_REGEX.test(c.req.path)) {
      return c.json({ message: 'Forbidden', statusCode: 403 }, 403);
    }

    await next();
  })
  .get('/csrf', async (c) => {
    const csrfToken = await setCsrfCookie(c);

    return c.json({ csrfToken });
  })
  .route('/', sessionRoute)
  .route('/', signOutRoute)
  .route('/', accountRoute)
  .route('/callback', callbackRoute)
  .route('/oauth', oauthRoute)
  .route('/email-password', emailPasswordRoute)
  .route('/passkey', passkeyRoute)
  .route('/two-factor', twoFactorRoute);

/**
 * Handle errors.
 */
auth.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json(
      {
        code: AppErrorCode.UNKNOWN_ERROR,
        message: err.message,
        statusCode: err.status,
      },
      err.status,
    );
  }

  if (err instanceof AppError) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const statusCode = (err.statusCode || 500) as ContentfulStatusCode;

    return c.json(
      {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
      },
      statusCode,
    );
  }

  // Handle other errors
  console.error('Unknown Error:', err);
  return c.json(
    {
      code: AppErrorCode.UNKNOWN_ERROR,
      message: 'Internal Server Error',
      statusCode: 500,
    },
    500,
  );
});

export type AuthAppType = typeof auth;
