# Kerbwell Sign source

This repository is the complete corresponding source of Kerbwell Sign, the document signing
service at https://sign.kerbwell.com.au, published under the GNU Affero General Public License
version 3 (see LICENSE), as section 13 of that licence requires.

Kerbwell Sign is a modified version of Documenso (https://github.com/documenso/documenso),
release v2.16.0, Copyright Documenso, Inc. and its contributors, AGPL-3.0.

Modifications by Black Shard Pty Ltd, licensed under the same terms:

- an environment-driven brand layer (BRAND_* variables, docker/KERBWELL.md) and the Kerbwell
  Sign bootstrap job (docker/kerbwell-bootstrap.mjs);
- packages/ee replaced by an AGPL stub: the upstream Documenso Commercial License package is not
  distributed here;
- portal single sign-on, webhook SSRF and signing hardening, dependency security updates;
- environment-driven response hardening (NEXT_PRIVATE_CSP_FRAME_ANCESTORS, NEXT_PRIVATE_HSTS,
  nosniff, X-Frame-Options), a password-reset switch for instances with no mail transport
  (NEXT_PUBLIC_DISABLE_PASSWORD_RESET), and a bootstrap job that never prints the API token;
- the document API limited to the internal host (NEXT_PRIVATE_INTERNAL_API_HOSTS), timestamped
  HMAC-SHA256 webhook signatures (X-Kerbwell-Signature), bootstrap defaults (audit log and
  certificate on every completed PDF, 14-day expiry, the full webhook trigger set), and the
  source publishing that keeps this notice's repository current (docker/kerbwell-source.sh).

Each running build links to its own source: a tag src-<tree> in the public mirror
blackshard-hq/kerbwell-sign-source whose git tree is exactly the tree the image was built from.
Security reports: security@kerbwell.com.au.
