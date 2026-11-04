import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ZDocumentAuditLogSchema } from '../../types/document-audit-logs';
import type { TKerbwellSignerAssertionClaims } from './claims';

const state = vi.hoisted(() => ({
  auditLogs: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<Record<string, unknown>>,
  jtis: new Set<string>(),
}));

vi.mock('@documenso/prisma', () => {
  const tx = {
    kerbwellGateAssertion: {
      create: vi.fn(async ({ data }: { data: { jti: string } }) => {
        if (state.jtis.has(data.jti)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        state.jtis.add(data.jti);
        return data;
      }),
    },
    kerbwellGateSession: {
      count: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          state.sessions.filter((s) => Object.entries(where).every(([k, v]) => s[k] === v)).length,
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.sessions.push(data);
        return data;
      }),
    },
    documentAuditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      }),
    },
  };

  return {
    prisma: {
      recipient: {
        findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
          where.id === 42
            ? {
                id: 42,
                token: 'recipient-token-42',
                email: 'vendor@example.com',
                name: 'Jordan Citizen',
                role: 'SIGNER',
                envelopeId: 'envelope_abc123',
                envelope: { id: 'envelope_abc123', secondaryId: 'document_7', status: 'PENDING', deletedAt: null },
              }
            : null,
        ),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

const { openKerbwellGateSession, KerbwellGateRefusedError, hashKerbwellGateHandle } = await import('./session');

const NOW = new Date('2026-11-04T01:00:00Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

const claims = (over: Partial<TKerbwellSignerAssertionClaims> = {}): TKerbwellSignerAssertionClaims => ({
  iss: 'https://auth.kerbwell.com.au',
  aud: 'sign',
  sub: '42',
  env: 'envelope_abc123',
  jti: 'jti_0123456789abcdef',
  iat: NOW_S,
  exp: NOW_S + 120,
  auth_time: NOW_S - 30,
  acr: 'kw-sign-l1',
  amr: ['otp_sms'],
  consent_version: 'au-eta-2026-11-pending-legal',
  consent_hash: 'b'.repeat(64),
  idv_ref: 'frankie-ref-123',
  legal_name: 'Jordan Example Citizen',
  doc_kind: 'agency_agreement',
  ip: '203.0.113.7',
  ua: 'Mozilla/5.0 (iPhone)',
  cf_city: 'Brisbane',
  mode: 'remote',
  ...over,
});

const requestMetadata = { ipAddress: '198.51.100.9', userAgent: 'Mozilla/5.0 (gate)' };

beforeEach(() => {
  state.auditLogs.length = 0;
  state.sessions.length = 0;
  state.jtis.clear();
});

describe('openKerbwellGateSession', () => {
  it('opens a session bound to the recipient, storing only the hash of the handle', async () => {
    const result = await openKerbwellGateSession({ claims: claims(), requestMetadata, now: NOW });

    expect(result.recipientToken).toBe('recipient-token-42');
    expect(result.handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      tokenHash: hashKerbwellGateHandle(result.handle),
      recipientId: 42,
      legalName: 'Jordan Example Citizen',
      docKind: 'agency_agreement',
    });
    expect(JSON.stringify(state.sessions[0])).not.toContain(result.handle);
    expect(result.expiresAt.getTime() - NOW.getTime()).toBe(30 * 60 * 1000);
  });

  it('writes KERBWELL_IDENTITY_VERIFIED with every identity claim, and KERBWELL_CONSENT_GIVEN', async () => {
    await openKerbwellGateSession({ claims: claims(), requestMetadata, now: NOW });

    const identity = state.auditLogs.find((l) => l.type === 'KERBWELL_IDENTITY_VERIFIED');
    const consent = state.auditLogs.find((l) => l.type === 'KERBWELL_CONSENT_GIVEN');

    expect(identity).toBeDefined();
    expect(identity?.ipAddress).toBe('198.51.100.9');
    expect(identity?.userAgent).toBe('Mozilla/5.0 (gate)');
    expect(identity?.data).toMatchObject({
      recipientId: 42,
      acr: 'kw-sign-l1',
      amr: ['otp_sms'],
      singleFactor: false,
      idvReference: 'frankie-ref-123',
      assertionId: 'jti_0123456789abcdef',
      verifiedIpAddress: '203.0.113.7',
      verifiedUserAgent: 'Mozilla/5.0 (iPhone)',
      cfCity: 'Brisbane',
      docKind: 'agency_agreement',
      reauthentication: false,
    });
    expect(consent?.data).toMatchObject({
      consentVersion: 'au-eta-2026-11-pending-legal',
      consentHash: 'b'.repeat(64),
    });

    // Both rows parse as audit log entries the certificate and the audit page can render.
    for (const row of [identity, consent]) {
      const parsed = ZDocumentAuditLogSchema.safeParse({ id: 'x', createdAt: NOW, ...row });
      expect(parsed.success).toBe(true);
    }
  });

  it('labels kw-sign-l1-single as single-factor', async () => {
    await openKerbwellGateSession({
      claims: claims({ acr: 'kw-sign-l1-single', doc_kind: 'general_non_prescribed' }),
      requestMetadata,
      now: NOW,
    });

    const identity = state.auditLogs.find((l) => l.type === 'KERBWELL_IDENTITY_VERIFIED');
    expect(identity?.data).toMatchObject({ singleFactor: true });
    expect(String((identity?.data as { assuranceLabel: string }).assuranceLabel)).toMatch(/single-factor/);
  });

  it('refuses a replayed jti', async () => {
    await openKerbwellGateSession({ claims: claims(), requestMetadata, now: NOW });
    const err = await openKerbwellGateSession({ claims: claims(), requestMetadata, now: NOW }).catch((e) => e);

    expect(err).toBeInstanceOf(KerbwellGateRefusedError);
    expect(err.reason).toBe('replay');
  });

  it('refuses a recipient on another envelope and an unknown recipient', async () => {
    const other = await openKerbwellGateSession({
      claims: claims({ env: 'envelope_other' }),
      requestMetadata,
      now: NOW,
    }).catch((e) => e);
    expect(other.reason).toBe('envelope');

    const unknown = await openKerbwellGateSession({ claims: claims({ sub: '43' }), requestMetadata, now: NOW }).catch(
      (e) => e,
    );
    expect(unknown.reason).toBe('recipient');
  });

  it('accepts the envelope secondary id, and records consent once per version', async () => {
    await openKerbwellGateSession({ claims: claims({ env: 'document_7' }), requestMetadata, now: NOW });
    await openKerbwellGateSession({ claims: claims({ jti: 'jti_second_0123456789' }), requestMetadata, now: NOW });

    expect(state.auditLogs.filter((l) => l.type === 'KERBWELL_IDENTITY_VERIFIED')).toHaveLength(2);
    expect(state.auditLogs.filter((l) => l.type === 'KERBWELL_CONSENT_GIVEN')).toHaveLength(1);
    expect(state.auditLogs.at(-1)?.data).toMatchObject({ reauthentication: true });
  });
});
