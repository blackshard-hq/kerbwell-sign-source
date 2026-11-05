import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { SessionProvider } from '@documenso/lib/client-only/providers/session';
import { brandStylesheetPath, brandSupportEmail, isDefaultBrand } from '@documenso/lib/constants/brand';
import { APP_I18N_OPTIONS, type SupportedLanguageCodes } from '@documenso/lib/constants/i18n';
import { createPublicEnv } from '@documenso/lib/utils/env';
import { extractLocaleData } from '@documenso/lib/utils/i18n';
import { TrpcProvider } from '@documenso/trpc/react';
import { getOrganisationSession } from '@documenso/trpc/server/organisation-router/get-organisation-session';
import { Button } from '@documenso/ui/primitives/button';
import { Toaster } from '@documenso/ui/primitives/toaster';
import { TooltipProvider } from '@documenso/ui/primitives/tooltip';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { useContext } from 'react';
import {
  data,
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useMatches,
  useNavigate,
} from 'react-router';
import { PreventFlashOnWrongTheme, ThemeProvider, useTheme } from 'remix-themes';

import type { Route } from './+types/root';
import stylesheet from './app.css?url';
import { BrandingLogo } from './components/general/branding-logo';
import { GenericErrorLayout } from './components/general/generic-error-layout';
import { SiteFooter } from './components/general/site-footer';
import { langCookie } from './storage/lang-cookie.server';
import { themeSessionResolver } from './storage/theme-session.server';
import { appMetaTags } from './utils/meta';
import { CspNonceContext, nonce } from './utils/nonce';

export const links: Route.LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export function meta() {
  return appMetaTags();
}

/**
 * Don't revalidate (run the loader on sequential navigations) on the root layout
 *
 * Update values via providers.
 */
export const shouldRevalidate = () => false;

export async function loader({ context, request }: Route.LoaderArgs) {
  const session = await getOptionalSession(request);

  const { getTheme } = await themeSessionResolver(request);

  const cookieHeader = request.headers.get('cookie') ?? '';

  let lang: SupportedLanguageCodes = await langCookie.parse(cookieHeader);

  if (!APP_I18N_OPTIONS.supportedLangs.includes(lang)) {
    lang = extractLocaleData({ headers: request.headers }).lang;
  }

  const disableAnimations = cookieHeader.includes('__disable_animations=true');

  let organisations = null;

  if (session.isAuthenticated) {
    organisations = await getOrganisationSession({ userId: session.user.id });
  }

  return data(
    {
      lang,
      theme: getTheme(),
      disableAnimations,
      // Surface the per-request CSP nonce produced by `securityHeadersMiddleware` so all
      // SSR-rendered <script>/<style> elements in this layout (and child
      // routes that need it) can carry the matching nonce attribute.
      nonce: context.nonce,
      session: session.isAuthenticated
        ? {
            user: session.user,
            session: session.session,
            organisations: organisations || [],
          }
        : null,
      publicEnv: createPublicEnv(),
    },
    {
      headers: {
        'Set-Cookie': await langCookie.serialize(lang),
      },
    },
  );
}

/**
 * The root loader's data. An error the router raises before any loader runs (an unmatched path
 * is a 404 of this kind) renders the Layout with none, which left the page with no CSP nonce:
 * every inline script (the brand env, the theme script) was refused, the client fell back to the
 * default brand and the page lost its title and language. Under a brand the Layout then takes
 * the request's nonce from CspNonceContext (entry.server.tsx). The estate's own instance is left
 * as it was.
 */
const useRootData = () => {
  const own = useLoaderData<typeof loader>();
  const requestNonce = useContext(CspNonceContext);

  if (own || isDefaultBrand()) {
    return own;
  }

  return { nonce: requestNonce } as Partial<NonNullable<typeof own>>;
};

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme } = useRootData() || {};

  return (
    <ThemeProvider specifiedTheme={theme} themeAction="/api/theme">
      <LayoutContent>{children}</LayoutContent>
    </ThemeProvider>
  );
}

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const { publicEnv, session, lang, disableAnimations, nonce: cspNonce, ...data } = useRootData() || {};

  const [theme] = useTheme();

  // An error the router raises before any loader runs (an unmatched path is a 404 of this
  // kind) renders this layout with no loader data. Under a brand the page still needs the
  // brand's public env, so the client names the same product the server did and the error page
  // keeps its title, and a language. The estate's own instance is left as it was.
  const pageEnv = publicEnv ?? errorPagePublicEnv();
  const pageLang = lang ?? (isDefaultBrand() ? undefined : 'en');
  const brandStylesheet = brandStylesheetPath();

  // Recipient routes (signing pages) put `documenso-branded` on <body> so the
  // <style> block from `RecipientBranding` applies to BOTH the main tree and
  // any portaled content (Radix dialogs/popovers/dropdowns mount outside the
  // route tree, attached directly to document.body).
  const matches = useMatches();
  const isRecipientRoute = matches.some((m) => m.id?.startsWith('routes/_recipient+'));

  return (
    // `suppressHydrationWarning` because `remix-themes` intentionally mutates
    // `data-theme`/`class` on <html> before hydration (PreventFlashOnWrongTheme),
    // so the server-rendered attributes never match the client render when the
    // theme is resolved from the system preference. Attribute-only, one level deep.
    <html translate="no" lang={pageLang} data-theme={theme} className={theme ?? ''} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="google" content="notranslate" />
        <Meta />
        <Links nonce={nonce(cspNonce)} />
        {brandStylesheet && <link rel="stylesheet" href={brandStylesheet} />}
        <meta name="google" content="notranslate" />
        <PreventFlashOnWrongTheme ssrTheme={Boolean(data.theme)} nonce={nonce(cspNonce)} />

        {disableAnimations && (
          <style
            nonce={nonce(cspNonce)}
            dangerouslySetInnerHTML={{
              __html: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
            }}
          />
        )}

        {/* Fix: https://stackoverflow.com/questions/21147149/flash-of-unstyled-content-fouc-in-firefox-only-is-ff-slow-renderer */}
        <script nonce={nonce(cspNonce)}>0</script>
      </head>
      <body className={isRecipientRoute ? 'documenso-branded' : undefined}>
        {/* Global license banner currently disabled. Need to wait until after a few releases. */}
        {/* {licenseStatus === '?' && (
          <div className="bg-destructive text-destructive-foreground">
            <div className="mx-auto flex h-auto max-w-screen-xl items-center justify-center px-4 py-3 text-sm font-medium">
              <div className="flex items-center">
                <AlertTriangleIcon className="mr-2 h-4 w-4" />
                <Trans>This is an expired license instance of Documenso</Trans>
              </div>
            </div>
          </div>
        )} */}

        <NuqsAdapter>
          <SessionProvider initialSession={session}>
            <TooltipProvider>
              <TrpcProvider>
                {children}

                <Toaster />
              </TrpcProvider>
            </TooltipProvider>
          </SessionProvider>
        </NuqsAdapter>

        <script
          nonce={nonce(cspNonce)}
          dangerouslySetInnerHTML={{
            // `__webpack_nonce__` is read by `get-nonce` (used by
            // react-remove-scroll / react-style-singleton inside Radix menus and
            // dialogs) to stamp runtime-injected <style> elements. Without it the
            // strict `style-src-elem` CSP blocks the scroll-lock styles.
            __html: `window.__ENV__ = ${JSON.stringify(pageEnv)}; window.__webpack_nonce__ = ${JSON.stringify(cspNonce ?? '')}`,
          }}
        />

        <ScrollRestoration nonce={nonce(cspNonce)} />
        <Scripts nonce={nonce(cspNonce)} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const errorCode = isRouteErrorResponse(error) ? error.status : 500;

  if (errorCode !== 404) {
    console.error('[RootErrorBoundary]', error);
  }

  if (!isDefaultBrand()) {
    return <BrandErrorPage errorCode={errorCode} />;
  }

  return <GenericErrorLayout errorCode={errorCode} />;
}

/**
 * The public env for a render with no root loader data. On the server it is built from the
 * process env, for a branded instance only; on the client it is what the server wrote.
 */
const errorPagePublicEnv = () => {
  if (typeof window !== 'undefined') {
    return window.__ENV__;
  }

  return isDefaultBrand() ? undefined : createPublicEnv();
};

const BRAND_ERRORS: Record<number, { heading: string; message: string }> = {
  401: {
    heading: 'Sign in to see this page',
    message: 'This page needs an account. Sign in, then open the link again.',
  },
  403: {
    heading: 'You do not have access to this page',
    message:
      'Your account cannot open this page. If someone sent you the link, ask them to check who it was shared with.',
  },
  404: {
    heading: 'Page not found',
    message: 'This address does not match a page. If a signing link brought you here, ask the sender to send it again.',
  },
  500: {
    heading: 'This page did not load',
    message: 'Something failed on our side while loading this page. Try again in a minute.',
  },
};

/**
 * The error page under a brand (BRAND_NAME set): the sign-in frame, the brand lockup, a Geist
 * Mono code label and plain copy. The estate keeps GenericErrorLayout.
 */
const BrandErrorPage = ({ errorCode }: { errorCode: number }) => {
  const navigate = useNavigate();
  const copy = BRAND_ERRORS[errorCode] ?? BRAND_ERRORS[500];
  const supportEmail = brandSupportEmail();

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 md:py-16">
        <Link
          to="/"
          className="mb-8 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <BrandingLogo className="h-8 w-auto" />
        </Link>

        <div className="w-full max-w-[26rem] rounded-lg border border-border bg-background p-6 md:p-8">
          <p className="kw-label kw-node kw-error-code">Error {errorCode}</p>

          <h1 className="mt-4 font-display text-3xl text-foreground leading-tight md:text-4xl">{copy.heading}</h1>

          <p className="mt-3 text-muted-foreground text-sm leading-6">{copy.message}</p>

          {errorCode >= 500 && (
            <p className="mt-3 text-muted-foreground text-sm leading-6">
              If it keeps happening, email{' '}
              <a
                href={`mailto:${supportEmail}`}
                className="text-foreground underline decoration-shard underline-offset-4 hover:opacity-70"
              >
                {supportEmail}
              </a>
              .
            </p>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="sm:min-w-32">
              <Link to="/">Home</Link>
            </Button>

            <Button
              variant="outline"
              className="sm:min-w-32"
              onClick={() => {
                void navigate(-1);
              }}
            >
              Go back
            </Button>
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
};
