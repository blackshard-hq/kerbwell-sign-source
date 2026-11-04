import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import {
  brandProductName,
  brandSecurityContact,
  brandSecurityExpires,
  brandSecurityPolicy,
} from '@documenso/lib/constants/brand';
import { Hono } from 'hono';

/**
 * The two public files that name the instance, served from the brand (constants/brand.ts)
 * instead of from /public, so one image answers for whichever brand it runs. Registered on the
 * router, which runs before the static handler in server/main.js, so these win.
 *
 * With no BRAND_* set, both answer what the static files they replace said.
 */
export const brandRoute = new Hono();

/** RFC 9116. Canonical is the address this instance serves it at. */
export const securityTxt = () => {
  const policy = brandSecurityPolicy();

  return [
    `Contact: ${brandSecurityContact()}`,
    `Expires: ${brandSecurityExpires()}`,
    'Preferred-Languages: en',
    `Canonical: ${NEXT_PUBLIC_WEBAPP_URL().replace(/\/+$/, '')}/.well-known/security.txt`,
    ...(policy === undefined ? [] : [`Policy: ${policy}`]),
    '',
  ].join('\n');
};

export const webManifest = () => ({
  name: brandProductName(),
  short_name: brandProductName(),
  icons: [
    { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
  ],
  theme_color: '#0A0A0A',
  background_color: '#FFFFFF',
  display: 'standalone',
});

brandRoute.get('/.well-known/security.txt', (c) =>
  c.body(securityTxt(), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  }),
);

brandRoute.get('/site.webmanifest', (c) =>
  c.body(JSON.stringify(webManifest(), null, 2), 200, {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  }),
);
