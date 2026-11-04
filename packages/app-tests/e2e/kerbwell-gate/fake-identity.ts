/**
 * A stand-in for Kerbwell Identity (auth.kerbwell.com.au) for the gate and admin sign-in specs.
 *
 * It serves an ES256 JWKS, mints signer assertions the way the real signer flow does, and hands
 * them to the browser as an auto-submitted top-level POST to <app>/api/kerbwell/gate. /signer is
 * the prompt=login re-entry Complete sends a stale signer to: it mints a fresh assertion for the
 * same recipient and envelope. It also answers as a minimal OIDC provider for the admin sign-in
 * (discovery, authorize, token), with the next id_token's amr and roles set by the spec.
 *
 * Test only. Listens on the port of KERBWELL_E2E_GATE_ISSUER (default http://127.0.0.1:4455),
 * which is what the app under test has as NEXT_PRIVATE_KERBWELL_GATE_ISSUER.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

export const GATE_ISSUER = (process.env.KERBWELL_E2E_GATE_ISSUER || 'http://127.0.0.1:4455').replace(/\/+$/, '');

export const OIDC_CLIENT_ID = process.env.KERBWELL_E2E_OIDC_CLIENT_ID || 'kerbwell-sign-e2e';

export type AssertionInput = {
  recipientId: number;
  envelopeId: string;
  authTime?: number;
  iat?: number;
  exp?: number;
  jti?: string;
  acr?: string;
  amr?: string[];
  legalName?: string;
  docKind?: string;
  idvRef?: string | null;
  audience?: string;
  mode?: 'remote' | 'in_person';
};

/**
 * One signing key per test process. The app caches the JWKS and refetches on an unknown kid at
 * most every 30 seconds, so every spec file in a run (gate, signer UI) signs with the same key.
 */
const PROCESS_KID = `e2e-${randomBytes(6).toString('hex')}`;
let processKeyPair: ReturnType<typeof generateKeyPair> | null = null;

type AdminLogin = { email: string; name: string; roles: string[]; amr: string[] };

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
};

export class FakeKerbwellIdentity {
  private server: Server | null = null;
  private privateKey!: CryptoKey;
  private jwk!: JWK;
  // A new kid per run, so an app that cached an earlier run's key set fetches this one.
  private readonly kid = PROCESS_KID;
  private readonly codes = new Map<string, AdminLogin>();

  /** The next admin OIDC sign-in's identity. */
  nextAdminLogin: AdminLogin = { email: 'admin@example.com', name: 'Admin', roles: [], amr: ['pwd'] };

  readonly issuer = GATE_ISSUER;

  /** Where the app under test is, for the auto-submitted gate POST. */
  constructor(private readonly appUrl: string) {}

  async start() {
    processKeyPair ??= generateKeyPair('ES256', { extractable: true });
    const { privateKey, publicKey } = await processKeyPair;
    this.privateKey = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: this.kid, alg: 'ES256', use: 'sig' };

    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        res.statusCode = 500;
        res.end(String(err));
      });
    });

    const port = Number(new URL(GATE_ISSUER).port || 80);

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, '127.0.0.1', () => resolve());
    });
  }

  async stop() {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  async mintAssertion(input: AssertionInput) {
    const now = Math.floor(Date.now() / 1000);
    const iat = input.iat ?? now;

    return new SignJWT({
      env: input.envelopeId,
      auth_time: input.authTime ?? now,
      acr: input.acr ?? 'kw-sign-l1',
      amr: input.amr ?? ['otp_sms'],
      consent_version: 'au-eta-e2e-pending-legal',
      consent_hash: 'c'.repeat(64),
      idv_ref: input.idvRef ?? null,
      legal_name: input.legalName ?? 'Jordan Example Citizen',
      doc_kind: input.docKind ?? 'agency_agreement',
      ip: '203.0.113.10',
      ua: 'Mozilla/5.0 (e2e)',
      cf_city: 'Brisbane',
      mode: input.mode ?? 'remote',
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.kid })
      .setIssuer(GATE_ISSUER)
      .setAudience(input.audience ?? 'sign')
      .setSubject(String(input.recipientId))
      .setJti(input.jti ?? randomBytes(18).toString('base64url'))
      .setIssuedAt(iat)
      .setExpirationTime(input.exp ?? iat + 120)
      .sign(this.privateKey);
  }

  /** The URL that auto-posts this assertion to the gate, as the real identity service does. */
  postUrl(assertion: string) {
    return `${GATE_ISSUER}/post?assertion=${encodeURIComponent(assertion)}`;
  }

  private autoPost(assertion: string) {
    return `<!doctype html><html><body>
<form id="f" method="post" action="${escapeHtml(this.appUrl)}/api/kerbwell/gate">
<input type="hidden" name="assertion" value="${escapeHtml(assertion)}">
<noscript><button type="submit">Continue</button></noscript>
</form>
<script>document.getElementById('f').submit();</script>
</body></html>`;
  }

  private async handle(req: IncomingMessage, res: import('node:http').ServerResponse) {
    const url = new URL(req.url ?? '/', GATE_ISSUER);

    const send = (status: number, type: string, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
      res.end(body);
    };

    switch (url.pathname) {
      case '/jwks':
        return send(200, 'application/json', JSON.stringify({ keys: [this.jwk] }));

      case '/post':
        return send(200, 'text/html', this.autoPost(url.searchParams.get('assertion') ?? ''));

      // The prompt=login re-entry: verify again (here, at once) and post a fresh assertion.
      case '/signer': {
        if (url.searchParams.get('prompt') !== 'login') {
          return send(400, 'text/plain', 'prompt=login required');
        }

        const assertion = await this.mintAssertion({
          recipientId: Number(url.searchParams.get('recipient')),
          envelopeId: url.searchParams.get('envelope') ?? '',
        });

        return send(200, 'text/html', this.autoPost(assertion));
      }

      case '/.well-known/openid-configuration':
        return send(
          200,
          'application/json',
          JSON.stringify({
            issuer: GATE_ISSUER,
            authorization_endpoint: `${GATE_ISSUER}/authorize`,
            token_endpoint: `${GATE_ISSUER}/token`,
            jwks_uri: `${GATE_ISSUER}/jwks`,
            scopes_supported: ['openid', 'email', 'profile'],
            response_types_supported: ['code'],
            id_token_signing_alg_values_supported: ['ES256'],
          }),
        );

      case '/authorize': {
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        const state = url.searchParams.get('state') ?? '';
        const code = randomBytes(12).toString('base64url');

        this.codes.set(code, { ...this.nextAdminLogin });

        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        target.searchParams.set('state', state);

        return send(302, 'text/plain', '', { Location: target.toString() });
      }

      case '/token': {
        const body = new URLSearchParams(await readBody(req));
        const login = this.codes.get(body.get('code') ?? '');

        if (!login) {
          return send(400, 'application/json', JSON.stringify({ error: 'invalid_grant' }));
        }

        this.codes.delete(body.get('code') ?? '');

        const idToken = await new SignJWT({
          email: login.email,
          email_verified: true,
          name: login.name,
          roles: login.roles,
          amr: login.amr,
        })
          .setProtectedHeader({ alg: 'ES256', kid: this.kid })
          .setIssuer(GATE_ISSUER)
          .setAudience(OIDC_CLIENT_ID)
          .setSubject(`admin-${login.email}`)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(this.privateKey);

        return send(
          200,
          'application/json',
          JSON.stringify({
            access_token: randomBytes(16).toString('hex'),
            token_type: 'Bearer',
            expires_in: 300,
            id_token: idToken,
          }),
        );
      }

      default:
        return send(404, 'text/plain', 'not found');
    }
  }
}
