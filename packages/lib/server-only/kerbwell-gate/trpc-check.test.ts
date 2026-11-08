import { beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({
  on: true,
  mode: 'all' as 'all' | 'recipient',
  recipients: new Map<string, number>(),
  authAgeSeconds: 60,
}));

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  return {
    ...actual,
    getKerbwellGateConfig: () =>
      gate.on
        ? {
            issuer: 'https://auth.kerbwell.com.au',
            jwksUrl: '',
            audience: 'sign',
            mode: gate.mode,
            reauthUrl: 'https://auth.kerbwell.com.au/signer',
            maxAuthAgeSeconds: 900,
          }
        : null,
  };
});

vi.mock('./enforce', () => ({
  checkKerbwellGateForToken: async ({ token, cookieHeader }: { token: string; cookieHeader: string | null }) => {
    const recipientId = gate.recipients.get(token);
    if (recipientId === undefined) {
      return { status: 'unknown_token' };
    }
    if (cookieHeader !== `ok-${recipientId}`) {
      return { status: 'refused', recipientId };
    }
    return {
      status: 'allowed',
      recipientId,
      authFresh: gate.authAgeSeconds <= 900,
      config: { reauthUrl: 'https://auth.kerbwell.com.au/signer', maxAuthAgeSeconds: 900 },
      session: { recipientId, envelopeId: 'envelope_abc' },
    };
  },
}));

vi.mock('@documenso/prisma', () => ({ prisma: {} }));

const { assertKerbwellGateForProcedure, KERBWELL_GATE_REQUIRED, KERBWELL_REAUTH_REQUIRED } = await import(
  './trpc-check'
);

const run = (path: string, rawInput: unknown, cookieHeader: string | null = null) =>
  assertKerbwellGateForProcedure({ path, rawInput, cookieHeader }).then(
    () => null,
    (e: { code: string; statusCode?: number; userMessage?: string }) => e,
  );

beforeEach(() => {
  gate.on = true;
  gate.mode = 'all';
  gate.recipients = new Map([
    ['tok-a', 1],
    ['tok-b', 2],
  ]);
  gate.authAgeSeconds = 60;
});

describe('assertKerbwellGateForProcedure', () => {
  it('refuses a recipient mutation without the gate cookie with 403', async () => {
    for (const path of ['field.signFieldWithToken', 'envelope.field.sign', 'recipient.rejectDocumentWithToken']) {
      const err = await run(path, { token: 'tok-a' });
      expect(err?.code).toBe(KERBWELL_GATE_REQUIRED);
      expect(err?.statusCode).toBe(403);
    }
  });

  it('refuses a cookie bound to another recipient, through token or recipientToken', async () => {
    expect((await run('field.signFieldWithToken', { token: 'tok-b' }, 'ok-1'))?.code).toBe(KERBWELL_GATE_REQUIRED);
    expect((await run('enterprise.cscSignEnvelope', { recipientToken: 'tok-b' }, 'ok-1'))?.code).toBe(
      KERBWELL_GATE_REQUIRED,
    );
  });

  it('lets the bound recipient through', async () => {
    expect(await run('field.signFieldWithToken', { token: 'tok-a' }, 'ok-1')).toBeNull();
  });

  it('ignores tokens that are not recipient tokens', async () => {
    expect(await run('organisation.member.invite.accept', { token: 'invite-xyz' })).toBeNull();
  });

  it('asks for re-auth at Complete after 16 minutes and not at 14', async () => {
    gate.authAgeSeconds = 16 * 60;
    const err = await run('recipient.completeDocumentWithToken', { token: 'tok-a' }, 'ok-1');
    expect(err?.code).toBe(KERBWELL_REAUTH_REQUIRED);
    expect(err?.statusCode).toBe(401);
    expect(err?.userMessage).toBe(
      'https://auth.kerbwell.com.au/signer?prompt=login&max_age=0&recipient=1&envelope=envelope_abc',
    );

    // Field signing keeps working on an older verification; only Complete asks again.
    expect(await run('field.signFieldWithToken', { token: 'tok-a' }, 'ok-1')).toBeNull();

    gate.authAgeSeconds = 14 * 60;
    expect(await run('recipient.completeDocumentWithToken', { token: 'tok-a' }, 'ok-1')).toBeNull();
  });

  it('refuses direct template signing under mode all only', async () => {
    expect((await run('template.createDocumentFromDirectTemplate', { directTemplateToken: 'd' }))?.code).toBe(
      KERBWELL_GATE_REQUIRED,
    );
    gate.mode = 'recipient';
    expect(await run('template.createDocumentFromDirectTemplate', { directTemplateToken: 'd' })).toBeNull();
  });

  it('does nothing with the gate off', async () => {
    gate.on = false;
    expect(await run('field.signFieldWithToken', { token: 'tok-a' })).toBeNull();
  });
});
