import { createContext } from 'react';
import { useRouteLoaderData } from 'react-router';

/**
 * The per-request CSP nonce, provided by entry.server.tsx around the whole render. The root
 * loader also returns it, but an error the router raises before any loader runs (an unmatched
 * path) renders the root Layout with no loader data; the Layout reads the nonce from here then.
 * Server only: on the client the value is undefined, and nonce() drops it anyway.
 */
export const CspNonceContext = createContext<string | undefined>(undefined);

/**
 * Returns the supplied CSP nonce only when rendering on the server.
 *
 * Browsers strip the `nonce` attribute from `getAttribute()` after CSP
 * processing for security (so reflected XSS can't read the nonce back out
 * of the DOM), but React 18's hydration reads via `getAttribute` and warns
 * about a mismatch when the JSX prop is non-empty:
 *
 *     Prop `nonce` did not match. Server: "" Client: "abc..."
 *
 * Returning `undefined` on the client makes React treat the prop as
 * "no attribute" — `shouldRemoveAttribute` short-circuits for nullish
 * values (see `react-dom/cjs/react-dom.development.js` `shouldRemoveAttribute`),
 * and the hydration prop-diff branch is skipped entirely.
 *
 * The nonce only matters at the moment the script/style is parsed by the
 * browser. After that it's an inert attribute, so dropping it on the
 * client has no functional impact. Subsequent dynamically-injected
 * scripts inherit trust via `'strict-dynamic'`.
 */
export const nonce = (value: string | undefined): string | undefined => (typeof window === 'undefined' ? value : '');

/**
 * Reads the per-request CSP nonce surfaced by the root loader. Use this
 * inside any non-root route component that needs to render a `<style>`,
 * `<script>`, or other element that the CSP gates by nonce.
 *
 * Centralised here so the cast is in one place — if the root loader's
 * `nonce` field is ever renamed/removed, only this function needs updating
 * (and TypeScript will catch it at the cast site).
 */
export const useCspNonce = (): string | undefined => {
  const rootData = useRouteLoaderData('root') as { nonce?: string } | undefined;

  return rootData?.nonce;
};
