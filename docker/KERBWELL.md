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
| `BRAND_FOOTER_TEXT` | the footer line, e.g. `Kerbwell` | no |
| `BRAND_SOURCE_URL` | leave unset: the image carries its own (see "Corresponding source" below). A value here overrides the image's and can point at the wrong build | no |
| `NEXT_PRIVATE_INTERNAL_API_HOSTS` | the app's internal FQDN, e.g. `kerbwell-esign.internal.<env-domain>`, comma separated if more than one. When set, `/api/v1`, `/api/v2` and `/api/v2-beta` return 404 unless the request's Host is listed, and to any request that carries a Cloudflare edge header (`cf-ray`, `cf-connecting-ip`, `cdn-loop`) whatever its Host. `/api/health`, `/api/auth`, `/api/trpc`, the gate and every page stay public. Unset, the lock is off (upstream behaviour) | no |
| `NEXT_PRIVATE_WEBHOOK_LEGACY_SECRET_HEADER` | `false` once every receiver verifies `X-Kerbwell-Signature`. Anything else (including unset) also sends the upstream `X-Documenso-Secret` header, which carries the secret in clear | no |
| `NEXT_PRIVATE_WEBHOOK_SSRF_BYPASS_HOSTS` | the staff app's internal FQDN, when the webhook targets it: an internal FQDN resolves to a private address, which the webhook SSRF guard refuses unless the host is listed here. List only that host | no |
| `NEXT_PRIVATE_KERBWELL_GATE_ISSUER` | `https://auth.kerbwell.com.au`. Turns the Kerbwell gate on (see "Kerbwell gate" below). Unset, the gate is off and a token opens its document, as upstream | no |
| `NEXT_PRIVATE_KERBWELL_GATE_MODE` | unset (`all`): every recipient needs the gate. `recipient` gates only recipients whose access or action auth names `KERBWELL_GATE`; `off` turns it off | no |
| `NEXT_PRIVATE_KERBWELL_GATE_JWKS_URL`, `_AUDIENCE`, `_REAUTH_URL`, `_MAX_AUTH_AGE` | unset: `<issuer>/jwks`, `sign`, `<issuer>/signer`, `900`. The JWKS and re-auth URLs must be on the issuer's origin; the age is 60 to 900 seconds | no |
| `NEXT_PRIVATE_KERBWELL_GATE_ACTIONS_URL` | the portal page behind "Something wrong?", e.g. `https://vendor.kerbwell.com.au/s/actions` (see "Signer UI" below). Unset: Ask the agent mails the agent, and Decline, Wrong person and Request paper use the fork's own decline with the reason filled in | no |
| `NEXT_PRIVATE_KERBWELL_GATE_PASSKEY_URL` | unset: `<issuer>/signer/passkey`, the passkey offer on the done page. Must be on the issuer origin | no |
| `NEXT_PRIVATE_CSP_SIGN_FRAME_ANCESTORS` | `https://client.kerbwell.com.au`: the only site that may frame `/sign` and `/d` (with `'self'`). With the gate on and this unset, they can be framed by this origin only | no |
| `NEXT_PUBLIC_KERBWELL_ADMIN_OIDC_ONLY` | `true`: the admin UI is reached only by OIDC against Kerbwell Identity, for the `kerbwell-sign-admin` role with a passkey amr (see "Admin sign-in" below) | no |
| `NEXT_PRIVATE_OIDC_WELL_KNOWN`, `NEXT_PRIVATE_OIDC_CLIENT_ID`, `NEXT_PRIVATE_OIDC_CLIENT_SECRET`, `NEXT_PRIVATE_OIDC_PROVIDER_LABEL` | `https://auth.kerbwell.com.au/.well-known/openid-configuration`, the `kerbwell-sign` client, its secret (Key Vault reference), `Kerbwell Account` | the secret |
| `NEXT_PRIVATE_KERBWELL_ADMIN_ROLE`, `_ROLES_CLAIM`, `_AMR` | unset: `kerbwell-sign-admin`, `roles`, `passkey,webauthn,hwk,swk` | no |
| `BRAND_SECURITY_CONTACT`, `BRAND_SECURITY_POLICY`, `BRAND_SECURITY_EXPIRES` | the security.txt fields; with a brand set, Contact defaults to `mailto:` the support mailbox and Policy is omitted when unset | no |

`/.well-known/security.txt` and `/site.webmanifest` are served from these values.

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
public. A skipped test fails the job. To run it locally, start the app the same way and set
`KERBWELL_E2E_INTERNAL_URL=http://127.0.0.1:3000`, `KERBWELL_E2E_PUBLIC_URL=http://localhost:3000`
and `KERBWELL_E2E_API_TOKEN`.

## Kerbwell gate

With `NEXT_PRIVATE_KERBWELL_GATE_ISSUER` set, a signer reaches a document only through Kerbwell
Identity. A copied `/sign/{token}` link on its own shows "This link is no longer active" and the
agent to contact, and every recipient call made with the token alone is refused.

1. The portal gate (`/s/{ref}`) hands the signer to Kerbwell Identity's signer flow, which
   verifies them on a second channel and mints a signer assertion.
2. Kerbwell Identity sends the browser here with an auto-submitted top-level POST:
   `POST https://sign.kerbwell.com.au/api/kerbwell/gate`, form field `assertion`.
3. The fork verifies the assertion against the issuer's JWKS (fetched from the pinned URL and
   cached), records its `jti` (a second use is refused), opens a 30-minute gate session for that
   one recipient, sets `__Host-kw_gate` (HttpOnly, Secure, SameSite=Lax, Path=/) and 303s to
   `/sign/{token}`. The token comes from the recipient row and never travels in Kerbwell's
   messages. A refused assertion lands on `/link-inactive?reason=retry`.
4. The signing pages, their data requests, the PDF file routes, the embed and report pages and
   every recipient tRPC call need that cookie for that recipient (403 or the inactive page
   otherwise). Direct template links are refused outright under mode `all`.
5. At Complete, a verification older than 15 minutes gets `KERBWELL_REAUTH_REQUIRED`; the
   browser goes to `<issuer>/signer?prompt=login&max_age=0&recipient=<id>&envelope=<id>`.
   Kerbwell Identity verifies the signer again and posts a fresh assertion, which returns them to
   the same document with their fields kept.

### The signer assertion

An ES256 JWT, at most 5 minutes from `iat` to `exp` (Kerbwell Identity mints 2):

| Claim | Meaning |
|---|---|
| `iss` | the issuer, exactly `NEXT_PRIVATE_KERBWELL_GATE_ISSUER` |
| `aud` | `sign` |
| `sub` | the Documenso recipient id |
| `env` | the envelope id (`envelope_...`) or its `document_<n>` secondary id |
| `jti` | single use, 16 to 128 of `A-Za-z0-9_-` |
| `iat`, `exp`, `auth_time` | seconds; `auth_time` is when the signer was verified |
| `acr` | `kw-sign-l1`, `kw-sign-l1-single` (one channel; labelled single-factor, refused for `agency_agreement`) or `kw-sign-l2` |
| `amr` | the methods used, e.g. `["otp_sms"]`, `["passkey"]`, `["otp_email","idv"]` |
| `consent_version`, `consent_hash` | the consent wording version and its SHA-256 (hex) |
| `idv_ref` | the FrankieOne reference at level 2, else null |
| `legal_name` | the CDD legal name (the typed signature defaults to it) |
| `doc_kind` | `agency_agreement`, `engagement_letter`, `cdd_acknowledgement` or `general_non_prescribed` |
| `ip`, `ua`, `cf_city` | what Kerbwell Identity saw at verification |
| `mode` | `remote` or `in_person` |

### What the audit log records

`KERBWELL_IDENTITY_VERIFIED` on every accepted assertion: acr, amr, the single-factor flag and
its label, auth time, IDV reference, assertion id, document kind, mode, and the ip, user agent
and city from verification (the row's own ip and user agent are the browser at the gate), and
whether it was a re-verification. `KERBWELL_CONSENT_GIVEN` the first time a recipient consents
on a given consent version and hash.

### The consent wording

`consent_version` must be `au-eta-2026-11-v1` and `consent_hash` the SHA-256 (hex) of
`kerbwellDisclosureCanonicalText()` as UTF-8, today
`6c88c0f94961efa16aeab384fae07714a1f95b78ab689fdeb1908ebf999ecb98`. Both live in
`packages/lib/constants/kerbwell-disclosure.ts`, which is also the text of
`/articles/signature-disclosure`. The gate's consent screen shows the same wording. A change to
the wording is a new version and a new hash; the unit test fails until the constant, the version
and the hash agree.

### Signer UI

Behind a gate session the signing page:

- opens the signature dialog on Type, filled with `legal_name` in the signature font, so it is
  adopted with one tap ("Adopt signature"); Draw is an equal tab. Upload is never offered when
  `doc_kind` is `agency_agreement`: the loader turns `uploadSignatureEnabled` off for that
  recipient whatever the document settings say. Dispatch should also send agency agreements with
  `uploadSignatureEnabled: false`, because a drawn and an uploaded signature are both images and
  the server cannot tell them apart.
- never bulk-signs fields (the upstream auto-sign dialog is off), so every signature and initial
  is its own tap. The final button reads "Sign agreement" beside "By tapping Sign agreement I sign
  this document and agree to be bound by it."
- shows "Something wrong?" (the sidebar on a desktop, a button in the bottom bar on a phone). With
  `NEXT_PRIVATE_KERBWELL_GATE_ACTIONS_URL` set, each action links to
  `<actions url>?action=<ask|decline|wrong-person|paper>&recipient=<id>&envelope=<id>`; the
  portal maps that to its gate record and confirms with the signer there.
- gives every field on the canvas a focusable button over its box, so Next field moves focus to
  the field and Enter or Space fills it (no drag, no pointer).
- ends on a done page that says the executed PDF is emailed when everyone has signed, offers the
  current copy, and links to `<passkey url>?recipient=<id>&envelope=<id>` unless `mode` was
  `in_person`.

Phone speed: the build writes brotli and gzip copies of every client asset
(`apps/remix/.bin/precompress.mjs`) and `server/main.js` serves them (`precompressed: true`), so
the signing page is about 1.3 MB on the wire instead of 4.9 MB while nothing in front of the app
compresses. The signing route preloads the pdf.js worker from its first byte of HTML, and the
viewer chunk starts downloading as soon as the page's modules run.

`packages/app-tests/e2e/kerbwell-signer-ui` checks this on a phone viewport, including an axe
WCAG 2.2 AA run on the signing page and the signature dialog.

### The agent on the inactive page

Dispatch sets the envelope's `meta.emailReplyTo` to the sending agent and adds the agent as a
recipient (the counter-signer or a CC). The page names that recipient. Without one it says "the
agent who sent it to you".

### Headers

`/sign`, `/d` and `/link-inactive` always send `Referrer-Policy: no-referrer` and
`Cache-Control: no-store`, and `frame-ancestors 'self'` plus `NEXT_PRIVATE_CSP_SIGN_FRAME_ANCESTORS`.

## Admin sign-in

`NEXT_PUBLIC_KERBWELL_ADMIN_OIDC_ONLY=true` leaves one way into the admin UI: OIDC against Kerbwell
Identity (`NEXT_PRIVATE_OIDC_*`). The callback verifies the id_token against the provider's
`jwks_uri` (ES256 or RS256, `iss` the discovered issuer, `aud` the client id) and accepts it only
with the `kerbwell-sign-admin` role in `roles` and a passkey method in `amr`; anything else goes
back to `/signin?error=KERBWELL_ADMIN_REFUSED` and touches no account. Email and password sign-in,
sign-up and reset, Google, Microsoft, organisation SSO and the built-in passkey sign-in all
answer 403, and `/signin` redirects straight to Kerbwell Identity. The client is a confidential
client with `client_secret_basic` and PKCE S256. The portal-session SSO handoff is removed.

The bootstrap administrator signs in through OIDC once Kerbwell Identity issues it the role (the
account is linked by its email). Its password stays in the database unused until INFRA-B removes
`KERBWELL_ESIGN_ADMIN_PASSWORD` from Key Vault after OIDC is proven.

CI runs `packages/app-tests/e2e/kerbwell-gate` against the image with the gate and the admin
lockdown on, using a stand-in identity service on 127.0.0.1:4455 (`fake-identity.ts`).

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
