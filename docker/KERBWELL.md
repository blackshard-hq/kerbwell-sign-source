# Kerbwell Sign

The same image as the estate eSign, run under the Kerbwell brand. Two processes use it: the app
(`sh start.sh`, the image default) and a one-shot setup job (`node kerbwell-bootstrap.mjs`). Both
run from `/app/apps/remix` against the same Postgres database.

## App environment

| Variable | Value for Kerbwell | Secret |
|---|---|---|
| `NEXT_PUBLIC_WEBAPP_URL` | `https://sign.kerbwell.com.au` | no |
| `NEXT_PRIVATE_INTERNAL_WEBAPP_URL` | `http://localhost:3000` | no |
| `NEXT_PRIVATE_DATABASE_URL`, `NEXT_PRIVATE_DIRECT_DATABASE_URL` | Kerbwell's own database, `sslmode=require` | yes |
| `NEXTAUTH_SECRET` | 64 random bytes, base64 | yes |
| `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` | 32+ random characters each, distinct | yes |
| `NEXT_PUBLIC_UPLOAD_TRANSPORT` | `database` | no |
| `NEXT_PRIVATE_SIGNING_TRANSPORT` | `local` | no |
| `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` | Kerbwell's own signing certificate, PKCS#12, base64 | yes |
| `NEXT_PRIVATE_SIGNING_PASSPHRASE` | the p12 passphrase | yes |
| `NEXT_PUBLIC_DISABLE_SIGNUP` | `true` | no |
| `NEXT_PUBLIC_DISABLE_PASSWORD_RESET` | `true` while there is no mail transport: hides "Forgot your password?" and refuses the reset request. The administrator is recovered by rerunning the bootstrap job, which resets the password to the Key Vault value | no |
| `NEXT_PRIVATE_CSP_FRAME_ANCESTORS` | `https://client.kerbwell.com.au`: the only site that may frame the signing, embed and auth pages (with `'self'`). Unset keeps the upstream wildcard | no |
| `NEXT_PRIVATE_HSTS` | `max-age=63072000; includeSubDomains`: sent on every response, because nothing in front of the app adds it | no |
| `NEXT_PRIVATE_SMTP_TRANSPORT` and the SMTP block | unset: the API client sends documents with distribution NONE and every email flag off, and the bootstrap turns the organisation's document emails off. Admin password-reset mail needs a transport; set one only when that is wanted | yes |
| `BRAND_NAME` | `Kerbwell` | no |
| `BRAND_PRODUCT_NAME` | `Kerbwell Sign` | no |
| `BRAND_URL` | `https://kerbwell.com.au` | no |
| `BRAND_FROM_NAME`, `BRAND_FROM_ADDRESS` | `Kerbwell Sign`, a kerbwell.com.au sender on the comms rail | no |
| `BRAND_SUPPORT_EMAIL` | the Kerbwell support mailbox | no |
| `BRAND_LOGO_PATH`, `BRAND_LOGO_DARK_PATH` | `/static/kerbwell-primary-light.svg`, `/static/kerbwell-primary-dark.svg` | no |
| `BRAND_MARK_PATH`, `BRAND_MARK_DARK_PATH` | `/static/kerbwell-mark-light.svg`, `/static/kerbwell-mark-dark.svg` | no |
| `BRAND_EMAIL_LOGO_PATH` | `/static/kerbwell-logo.png` | no |
| `BRAND_STYLESHEET_PATH` | `/static/kerbwell-brand.css`: Geist, the Kerbwell colour tokens and the error page styles, linked after the app's own stylesheet. Only a same-origin `.css` path is accepted; unset links nothing | no |
| `BRAND_FOOTER_TEXT` | the footer line, e.g. `Kerbwell` | no |
| `BRAND_SOURCE_URL` | leave unset: the image carries its own (see "Corresponding source" below). A value here overrides the image's and can point at the wrong build | no |
| `NEXT_PRIVATE_INTERNAL_API_HOSTS` | the app's internal FQDN, e.g. `kerbwell-esign.internal.<env-domain>`, comma separated if more than one. When set, `/api/v1`, `/api/v2` and `/api/v2-beta` return 404 unless the request's Host is listed, and to any request that carries a Cloudflare edge header (`cf-ray`, `cf-connecting-ip`, `cdn-loop`) whatever its Host. `/api/health`, `/api/auth`, `/api/trpc`, the gate and every page stay public. Unset, the lock is off (upstream behaviour) | no |
| `KERBWELL_PUBLIC_SIGNIN_REDIRECT` | `https://app.kerbwell.com.au`: no public sign-in or dashboard (see "Public surface lock" below). Every page outside the signer, embed and platform paths answers 302 to this URL on a public host. A value that is not an absolute http(s) URL keeps the lock on and answers 404. Unset, the lock is off (upstream behaviour; the estate instance leaves it unset) | no |
| `NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER` | `false` once every receiver verifies `X-Kerbwell-Signature`. Anything else (including unset) also sends the upstream `X-Documenso-Secret` header, which carries the secret in clear | no |
| `NEXT_PRIVATE_WEBHOOK_SSRF_BYPASS_HOSTS` | the staff app's internal FQDN, when the webhook targets it: an internal FQDN resolves to a private address, which the webhook SSRF guard refuses unless the host is listed here. List only that host | no |
| `BRAND_SECURITY_CONTACT`, `BRAND_SECURITY_POLICY`, `BRAND_SECURITY_EXPIRES` | the security.txt fields; with a brand set, Contact defaults to `mailto:` the support mailbox and Policy is omitted when unset | no |

`/.well-known/security.txt` and `/site.webmanifest` are served from these values.

## Public surface lock

`sign.kerbwell.com.au` has one account, the platform administrator. Staff work in
`app.kerbwell.com.au`, which drives this instance through the API; signers arrive on signing links
or through the client portal embed. With `KERBWELL_PUBLIC_SIGNIN_REDIRECT` set
(`apps/remix/server/public-surface-lock.ts`), a request on a public host answers 302 to that URL
(with `Cache-Control: no-store`, any method) unless its path is one of these, which behave as
before:

| Path | Why it stays open |
|---|---|
| `/sign/*`, `/d/*` | signing links and direct template links |
| `/embed/*` | the client portal embed (signing and authoring) |
| `/share/*`, `/report/*`, `/articles/*` | shared completed documents, the recipient report link, the signature disclosure linked from the signing page |
| `/__htmltopdf/*` | the certificate and audit-log render the app calls on itself while sealing |
| `/api/*` | everything under it, including `/api/auth`, `/api/trpc`, `/api/health` and the Kerbwell gate. The document API keeps its own lock (`NEXT_PRIVATE_INTERNAL_API_HOSTS`, above) |
| `/assets/*`, `/__manifest`, `/static/*`, `/fonts/*` | the built client, route discovery, the brand files and fonts |
| `/.well-known/*`, `/site.webmanifest`, `/favicon*`, `/apple-*`, `/android-chrome-*`, `/robots.txt`, `/opengraph-image.jpg` | security.txt, the manifest and the icons |

Everything else redirects: `/`, `/signin`, `/signup`, `/forgot-password`, `/reset-password`,
`/check-email`, `/verify-email`, `/o/*/signin`, the organisation invite pages, `/inbox`,
`/dashboard`, `/t/*`, `/o/*`, `/settings/*`, `/admin/*`, public profiles and any unknown path.
The list is of what stays open, so a route upstream adds later is closed until it is named in
`PUBLIC_PATH_REGEX`. Matching is case-sensitive (`/SignIn` redirects). The footer's source link
is an absolute URL on the public mirror and every page that shows the footer (signing,
completion) is open, so the AGPL-3.0 section 13 link is unaffected.

A request whose Host is one of `NEXT_PRIVATE_INTERNAL_API_HOSTS` and that carries no Cloudflare
edge header passes untouched, the same rule as the API lock. Kerbwell production does not set
`NEXT_PRIVATE_INTERNAL_API_HOSTS` (the staff app calls the API on `https://sign.kerbwell.com.au`),
and the internal FQDN answers only inside the Container Apps environment (the public ingress
returns 404 for it), so no browser reaches the dashboard that way.

Administrator access. The administrator signs in through a short window with the lock off, as a
root change through bs-rootq on Kane's go:

    bs-az containerapp update -g kerbwell-prod-rg -n kerbwell-esign --remove-env-vars KERBWELL_PUBLIC_SIGNIN_REDIRECT
    # sign in at https://sign.kerbwell.com.au/signin, do the admin work, sign out
    bs-az containerapp update -g kerbwell-prod-rg -n kerbwell-esign --set-env-vars KERBWELL_PUBLIC_SIGNIN_REDIRECT=https://app.kerbwell.com.au
    curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://sign.kerbwell.com.au/signin   # 302 https://app.kerbwell.com.au/

Sign-up stays disabled and the password reset refused during the window
(`NEXT_PUBLIC_DISABLE_SIGNUP`, `NEXT_PUBLIC_DISABLE_PASSWORD_RESET`). Most administration needs no
window: organisation settings, branding, the webhook and the API token are set by rerunning the
bootstrap job, and the administrator password is reset the same way. `bs-az containerapp exec`
gives a shell in the container, not a browser, and Container Apps has no port forward. No IP
allowlist or other exception is added for the administrator.

`npx vitest run server/public-surface-lock.test.ts` (in `apps/remix`) covers the redirected and
open paths, the internal host, the edge header, an invalid value and the lock being off. CI also
starts a second app from the image with the lock on and runs
`packages/app-tests/e2e/kerbwell-surface-lock` against it, which creates and sends an envelope
through the internal API and opens its signing link on the public host in a browser.

## Brand

The Kerbwell brand kit of 4 November 2026 with the Bitumen palette of 5 November 2026: the drawn
mark (a K cut from a kerb-and-channel section), the Geist 600 wordmark, Geist and Geist Mono,
and the Kerbwell colour tokens
(`packages/ui/src/tokens/kerbwell.css` in the product repository). Every file is under
`apps/remix/public/static/kerbwell-*` and is used only when the variables above name it.

| File | What it is |
|---|---|
| `kerbwell-primary-light.svg`, `kerbwell-primary-dark.svg` | horizontal lockup in the 1042 x 206 box `BrandingLogo` reserves: light pages, the yellow mark on its Night tile with a Night wordmark; dark pages, the yellow mark bare with a Paper wordmark |
| `kerbwell-mark-light.svg`, `kerbwell-mark-dark.svg` | the mark alone, square: on its Night tile (light pages), bare yellow (dark pages) |
| `kerbwell-logo.png` | 1200 x 361 lockup for email and the recipient-page logo, transparent: the mark on its Night tile, Night wordmark |
| `kerbwell-brand.css` | `@font-face` for Geist 400/500/600 and Geist Mono 400, the semantic colour tokens as HSL triples for light and dark, the record-node hairline under the sign-in heading, focus and error page styles |
| `kerbwell-geist-*.woff2`, `kerbwell-geist-OFL.txt` | the fonts (SIL Open Font License 1.1, licence beside them) |

Colour. The values are the product's token file (`packages/ui/src/tokens/kerbwell.css`), Bitumen
with line-marking yellow, Paper light base and the warm Bitumen dark base. Light: the page is
the warm surface #FBFAF6 with white cards, Night (#0B0A09) text and muted text #47443E (9.29:1
on the page, 7.77:1 on the hover fill); links, the focus ring and the field-card edge are
Bitumen #272622 (12.13:1 on the worst surface); the filled primary button is the yellow #FFC21A
with a Night label (12.23:1). The yellow is 1.62:1 on white, so it never sits bare on a light
page: the mark sits on its Night tile (the app icon) and the record nodes take a 1px Night edge.
Dark: canvas #12110F, Asphalt cards, Paper text, muted #C4C0B6 (7.89:1 on the worst dark
surface), primary, ring and field-card edge the yellow with a Night label. Input edges are
Slate #858177, 3:1 or better in both. Every text pair is 7:1 or better;
`packages/lib/constants/brand-kerbwell.test.ts` checks the HSL triples against their hex values
and the contrast floors.

A different accent is the `--kw-accent-*` lines and the HSL triples marked "accent" in
`kerbwell-brand.css`, taken from the same steps of the token file's accent block, the mark fill
in the four SVGs and the PNG, and `primary`, `primaryForeground`, `ring` and `fieldCardBorder`
in `KERBWELL_ESIGN_BRANDING_COLORS` below.

Error pages. Under a brand (`BRAND_NAME` set) the root error boundary shows the sign-in frame
with the lockup, an "Error 404" label, a plain heading ("Page not found") and Home and Go back
buttons; the page title is `BRAND_PRODUCT_NAME` and the document language is `en`. The estate's
instance keeps its own error page.

Recipient pages (signing, completion) take the organisation branding the bootstrap job writes.
Kerbwell's values pin those pages to the light palette on every device, as the estate does:

```
KERBWELL_ESIGN_BRANDING_COLORS={"background":"#FBFAF6","foreground":"#0B0A09","muted":"#EDEAE0","mutedForeground":"#47443E","popover":"#FFFFFF","popoverForeground":"#0B0A09","card":"#FFFFFF","cardBorder":"#D9D5CA","cardForeground":"#0B0A09","fieldCard":"#FFFFFF","fieldCardBorder":"#272622","fieldCardForeground":"#0B0A09","widget":"#EDEAE0","widgetForeground":"#0B0A09","border":"#D9D5CA","input":"#858177","primary":"#272622","primaryForeground":"#FFC21A","secondary":"#E9E6DC","secondaryForeground":"#0B0A09","accent":"#E9E6DC","accentForeground":"#0B0A09","destructive":"#8B2320","destructiveForeground":"#FFFFFF","ring":"#272622","envelopeEditorBackground":"#EDEAE0"}
KERBWELL_ESIGN_BRANDING_CSS=color-scheme: light; .dark\:text-gray-400.dark\:text-gray-400 { color: #47443E; } .dark\:bg-gray-400\/10.dark\:bg-gray-400\/10 { background-color: #EDEAE0; } .dark\:text-green-400.dark\:text-green-400 { color: #1B542C; } .dark\:bg-green-500\/10.dark\:bg-green-500\/10 { background-color: #E5F0E7; } .dark\:text-blue-400.dark\:text-blue-400 { color: #1F4A7E; } .dark\:bg-blue-400\/10.dark\:bg-blue-400\/10 { background-color: #E5ECF5; } .dark\:text-red-400.dark\:text-red-400 { color: #8B2320; } .dark\:bg-red-400\/10.dark\:bg-red-400\/10 { background-color: #F8E6E3; } .dark\:text-yellow-500.dark\:text-yellow-500 { color: #6B4002; } .dark\:bg-yellow-400\/10.dark\:bg-yellow-400\/10 { background-color: #F6ECDA; } .dark\:text-orange-400.dark\:text-orange-400 { color: #6B4002; } .dark\:bg-orange-400\/10.dark\:bg-orange-400\/10 { background-color: #F6ECDA; }
KERBWELL_ESIGN_BRANDING_LOGO_FILE=public/static/kerbwell-logo.png
```

The CSS holds the light palette on pages that otherwise follow a dark device setting: the
status badges that use `dark:` colours get the token file's light status inks on their soft
fills, 7:1 or better.

## Bootstrap job environment

| Variable | Meaning | Secret |
|---|---|---|
| database variables | as the app | yes |
| `KERBWELL_ESIGN_ADMIN_EMAIL` | the instance administrator | no |
| `KERBWELL_ESIGN_ADMIN_PASSWORD` | 12+ characters, a Key Vault secret reference | yes |
| `KERBWELL_ESIGN_WEBHOOK_URL` | the staff app's internal https FQDN, e.g. `https://kerbwell-staff.internal.<env-domain>/api/integrations/esign/webhook` (put the same host in the app's `NEXT_PRIVATE_WEBHOOK_SSRF_BYPASS_HOSTS`). Moving it is a rerun: the old row, recognised by the same secret, is removed | no |
| `KERBWELL_ESIGN_WEBHOOK_SECRET` | 16+ characters, the same value as the staff app's `REALSAAS_ESIGN_WEBHOOK_SECRET` | yes |
| `KERBWELL_ESIGN_TOKEN` | the API token, generated by the operator (`api_` and 16 to 64 of a-z, 0-9) and held in Key Vault; the job stores its hash and removes every other token of that name | yes |
| `KERBWELL_ESIGN_TOKEN_OUT` | file for a token the fork issues (mode 0600), when `KERBWELL_ESIGN_TOKEN` is unset | no |
| `KERBWELL_ESIGN_ROTATE_TOKEN` | with `KERBWELL_ESIGN_TOKEN_OUT`, `1` replaces an existing `realsaas-kerbwell` token | no |
| `KERBWELL_ESIGN_ORG_NAME`, `_ORG_URL`, `_TEAM_NAME`, `_TEAM_URL`, `_TOKEN_NAME`, `_ADMIN_NAME` | defaults `Kerbwell`, `kerbwell`, `Kerbwell`, `kerbwell`, `realsaas-kerbwell`, `Kerbwell Sign administrator` | no |
| `KERBWELL_ESIGN_BRANDING_URL`, `_COMPANY_DETAILS`, `_COLORS` (JSON of `#RRGGBB`), `_CSS`, `_LOGO_FILE` (PNG path in the image, e.g. `public/static/kerbwell-logo.png`) | recipient-page branding on the organisation, as infra/esign/branding/apply.py sets it for the estate | no |
| `KERBWELL_ESIGN_ALLOW_HTTP_WEBHOOK` | `1` only for a scratch run against a local listener | no |

The token is never printed. On ACA, generate it on the operator's machine, write it to Key Vault
(`kw-esign-token`, through ARM, never on a command line) and run the job with `KERBWELL_ESIGN_TOKEN`
as a secret reference to it. To rotate: write a new value to the same secret and rerun the job;
it stores the new hash and deletes the old token, and the staff app reads the new value on its
next revision. With neither `KERBWELL_ESIGN_TOKEN` nor `KERBWELL_ESIGN_TOKEN_OUT` set the job
exits 2.

Exit codes: 0 ready, 1 a step failed, 2 configuration missing or invalid.

### What the job sets

- Webhook triggers: `DOCUMENT_CREATED`, `DOCUMENT_SENT`, `DOCUMENT_OPENED`, `DOCUMENT_SIGNED`,
  `DOCUMENT_RECIPIENT_COMPLETED`, `DOCUMENT_COMPLETED`, `DOCUMENT_REJECTED`,
  `DOCUMENT_CANCELLED`, `RECIPIENT_EXPIRED`. `DOCUMENT_SIGNED` is the per-recipient signed
  event: the fork fires it each time one recipient signs, and has no separate
  `RECIPIENT_SIGNED` trigger. Receivers map it to "recipient signed".
- Organisation defaults: signing certificate and audit log appended to every completed PDF;
  envelopes expire 14 days after they are sent (`envelopeExpirationPeriod` `{unit: day,
  amount: 14}`); every document email off. A team-level override of the certificate, audit log
  or expiry is aligned to these.
- Organisation claim flags: `cfr21` (recipient action auth, which the Kerbwell gate uses),
  `allowCustomBranding`, `hidePoweredBy`, `unlimitedDocuments`, merged into the claim the
  organisation already has. The features these switch on are AGPL code in `packages/lib`;
  `packages/ee` stays the severed stubs. Upstream's licence client marks `cfr21` as an
  enterprise flag and so reports the instance as unlicensed in the admin panel; nothing else
  changes.

`node --test kerbwell-bootstrap.test.mjs` inside the image, against a fresh migrated database,
checks all of this and that a second run changes nothing. `docker/kerbwell-bootstrap.test.sh
IMAGE` sets up the throwaway database and runs it.

CI (`kerbwell-source.yml`, job `image_tests`) runs that test on every pull request, then starts
the app from the same image with `NEXT_PRIVATE_INTERNAL_API_HOSTS=127.0.0.1`, runs the bootstrap
job against it and runs `packages/app-tests/e2e/kerbwell-platform` (Playwright, request only):
`/api/v1`, `/api/v2`, `/api/v2-beta` and the OpenAPI document return 404 on `localhost` even with
a valid token, `/api/v2/envelope` returns 200 on `127.0.0.1` with the bootstrap token, any
request carrying a Cloudflare edge header returns 404, and `/api/health` and `/signin` stay
public (this app runs with `KERBWELL_PUBLIC_SIGNIN_REDIRECT` unset). A skipped test fails the job. To run it locally, start the app the same way and set
`KERBWELL_E2E_INTERNAL_URL=http://127.0.0.1:3000`, `KERBWELL_E2E_PUBLIC_URL=http://localhost:3000`
and `KERBWELL_E2E_API_TOKEN`.

## Webhook signature

Every delivery carries

    X-Kerbwell-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>

over the exact body bytes sent. A receiver recomputes the HMAC from the raw body and the `t` it
was given, compares in constant time, and refuses a `t` more than 300 seconds from its own
clock (either way). Several `v1=` values may appear while a secret rotates. The reference
receiver is `verifyWebhookSignature` in
`packages/lib/server-only/webhooks/kerbwell-signature.ts`. Until
`NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER=false`, `X-Documenso-Secret` is sent as well.

## Corresponding source (AGPL-3.0 section 13)

`blackshard-hq/kerbwell-sign` is private. The source of every build is published to the public,
read-only mirror `blackshard-hq/kerbwell-sign-source` before the image is built:

    docker/kerbwell-source.sh image HEAD kerbwellacr.azurecr.io/kerbwell-esign:<sha>

`image` scans and publishes the tree, checks the link, then builds from a `git archive` of
exactly that commit with `KERBWELL_SOURCE_URL` and `KERBWELL_SOURCE_REVISION` set. By hand:

    docker/kerbwell-source.sh release HEAD    # scan, push, check; prints the URL
    docker build -f docker/Dockerfile \
      --build-arg KERBWELL_SOURCE_URL="$(docker/kerbwell-source.sh url HEAD)" \
      --build-arg KERBWELL_SOURCE_REVISION="$(git rev-parse HEAD)" .

The Dockerfile enforces this whichever route builds the image. Its default target (`runner`)
depends on a `source-gate` stage that runs `docker/kerbwell-source-gate.mjs`, and the build
fails unless `KERBWELL_SOURCE_URL` is
`https://github.com/blackshard-hq/kerbwell-sign-source/tree/src-<12 hex>` and that URL answers
200 to an anonymous request. An empty value, a commit of the private repository, another
repository and a tag that was never published all fail the build. The `unpublished` target is
the app without the link (label `au.com.kerbwell.unpublished=true`); CI and
`docker/testing/compose.yml` build it only to check the code compiles. Never push or deploy it.

- The mirror commit has exactly the build's git tree (no fork history) and is tagged
  `src-<first 12 of the tree id>`. Anyone can match it: `git rev-parse <commit>^{tree}`.
- `scan` runs gitleaks over the tree first. Reviewed upstream samples are listed by
  `path:rule:line` in `docker/kerbwell-gitleaks.ignore`; any other finding stops the publish.
- `check` passes only when the URL answers 200 to an anonymous request (no token, no cookie,
  not a sign-in page). CI also runs it against a commit of the private repository and fails if
  that passes.
- The image sets `BRAND_SOURCE_URL` from the build argument, so the footer and recipient pages
  link to the source of the build that is running. The image labels carry the same URL
  (`au.com.kerbwell.source-url`) and the revision.
- `.github/workflows/kerbwell-source.yml` does this on every push to `main`, with a write
  deploy key on the mirror only (`KERBWELL_SOURCE_DEPLOY_KEY`).
  On every pull request it also builds the `source-gate` stage with an empty URL, a private
  commit, an unpublished tag and another host, and fails unless each is refused and a
  published tag passes.
