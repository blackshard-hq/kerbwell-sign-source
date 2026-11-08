import { PassThrough } from 'node:stream';
import { APP_I18N_OPTIONS } from '@documenso/lib/constants/i18n';
import { dynamicActivate, extractLocaleData } from '@documenso/lib/utils/i18n';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createReadableStreamFromReadable } from '@react-router/node';
import type { RenderToPipeableStreamOptions } from 'react-dom/server';
import { renderToPipeableStream } from 'react-dom/server';
import type { AppLoadContext, EntryContext } from 'react-router';
import { ServerRouter } from 'react-router';

import { langCookie } from './storage/lang-cookie.server';

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext,
) {
  let language = await langCookie.parse(request.headers.get('cookie') ?? '');

  if (!APP_I18N_OPTIONS.supportedLangs.includes(language)) {
    language = extractLocaleData({ headers: request.headers }).lang;
  }

  await dynamicActivate(language);

  // Threaded into ServerRouter so React Router applies the nonce to the
  // scripts it injects (route manifest, hydration data, module preloads).
  // The same nonce is also exposed to the React tree via the root loader so
  // our own inline scripts/styles can carry it.
  const nonce = loadContext.nonce || undefined;

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    // Black Shard: every document renders whole before the first byte. Sent at shell-ready, the shell up to </html>
    // went first and React Router's loader-data stream (the Suspense chunks of <Scripts>, with their <!--$-->
    // markers) followed in later writes; a browser that had already closed the document showed a bare "$" at the
    // foot of every page. One write leaves nothing to arrive late. Bots and SPA mode already took this path.
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    const readyOption: keyof RenderToPipeableStreamOptions = 'onAllReady';

    const { pipe, abort } = renderToPipeableStream(
      <I18nProvider i18n={i18n}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </I18nProvider>,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set('Content-Type', 'text/html');

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );

    // Abort the rendering stream after the `streamTimeout` so it has time to
    // flush down the rejected boundaries
    setTimeout(abort, streamTimeout + 1000);
  });
}
