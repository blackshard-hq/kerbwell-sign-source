import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The current request's gate cookie, for code deep in the signing path (isRecipientAuthorized)
 * that has no request of its own. apps/remix/server/api/kerbwell-gate.ts runs every request inside
 * this store. Outside a request (jobs, the CLI) it is empty, so the gate check fails closed.
 */
type KerbwellGateRequestStore = {
  cookieHeader: string | null;
};

const store = new AsyncLocalStorage<KerbwellGateRequestStore>();

export const runWithKerbwellGateRequest = <T>(cookieHeader: string | null, fn: () => T): T =>
  store.run({ cookieHeader }, fn);

export const getKerbwellGateRequestCookieHeader = (): string | null => store.getStore()?.cookieHeader ?? null;
