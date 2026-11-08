import { AppError } from '../../errors/app-error';
import { getKerbwellGateConfig } from './config';
import { checkKerbwellGateForToken } from './enforce';
import { buildKerbwellReauthUrl } from './session';

/**
 * The tRPC side of the Kerbwell gate (packages/trpc/server/trpc.ts kerbwellGateMiddleware).
 *
 * Every unauthenticated or maybe-authenticated procedure that carries a recipient token (`token`
 * or `recipientToken`) needs a live gate cookie for that recipient: a copied token on its own gets
 * KERBWELL_GATE_REQUIRED (403). Complete also needs the identity verification behind the cookie
 * to be no older than the configured maximum (15 minutes); an older one gets
 * KERBWELL_REAUTH_REQUIRED (401) with the Kerbwell Identity URL to verify again in userMessage,
 * which the client follows (packages/trpc/react).
 *
 * Direct template links have no recipient to gate, so under mode `all` they are refused outright.
 */
export const KERBWELL_GATE_REQUIRED = 'KERBWELL_GATE_REQUIRED';
export const KERBWELL_REAUTH_REQUIRED = 'KERBWELL_REAUTH_REQUIRED';

const COMPLETE_PATHS = new Set(['recipient.completeDocumentWithToken']);

const NO_RECIPIENT_PATHS = new Set(['template.createDocumentFromDirectTemplate']);

const readRecipientTokens = (rawInput: unknown): string[] => {
  if (!rawInput || typeof rawInput !== 'object') {
    return [];
  }

  const tokens: string[] = [];

  for (const key of ['token', 'recipientToken'] as const) {
    const value = (rawInput as Record<string, unknown>)[key];

    if (typeof value === 'string' && value.length > 0 && value.length <= 256) {
      tokens.push(value);
    }
  }

  return tokens;
};

const gateRequired = () =>
  new AppError(KERBWELL_GATE_REQUIRED, { message: 'This link is no longer active.', statusCode: 403 });

export const assertKerbwellGateForProcedure = async ({
  path,
  rawInput,
  cookieHeader,
  now = new Date(),
}: {
  path: string;
  rawInput: unknown;
  cookieHeader: string | null;
  now?: Date;
}): Promise<void> => {
  const config = getKerbwellGateConfig();

  if (!config) {
    return;
  }

  if (config.mode === 'all' && NO_RECIPIENT_PATHS.has(path)) {
    throw gateRequired();
  }

  for (const token of readRecipientTokens(rawInput)) {
    const check = await checkKerbwellGateForToken({ token, cookieHeader, now });

    if (check.status === 'refused') {
      throw gateRequired();
    }

    if (check.status === 'allowed' && COMPLETE_PATHS.has(path) && !check.authFresh) {
      throw new AppError(KERBWELL_REAUTH_REQUIRED, {
        message: 'Confirm it is you again before you sign.',
        userMessage: buildKerbwellReauthUrl(check.config, check.session),
        statusCode: 401,
      });
    }
  }
};
