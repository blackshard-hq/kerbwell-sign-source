import { createHash, randomBytes } from 'node:crypto';

import { prisma } from '@documenso/prisma';
import type { KerbwellGateSession } from '@prisma/client';
import { DocumentStatus, Prisma } from '@prisma/client';

import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import type { RequestMetadata } from '../../universal/extract-request-metadata';
import { createDocumentAuditLogData } from '../../utils/document-audit-logs';
import { isSingleFactorAcr, type TKerbwellAcr, type TKerbwellSignerAssertionClaims } from './claims';
import { KERBWELL_GATE_SESSION_TTL_SECONDS, type KerbwellGateConfig } from './config';
import { readKerbwellGateCookie } from './cookie';

export const hashKerbwellGateHandle = (handle: string) => createHash('sha256').update(handle).digest('hex');

export const KERBWELL_ACR_LABELS: Record<TKerbwellAcr, string> = {
  'kw-sign-l1': 'Level 1: one-time code on a second channel',
  'kw-sign-l1-single': 'Level 1, single-factor: link and code on one channel',
  'kw-sign-l2': 'Level 2: one-time code and identity document match',
};

export type KerbwellGateRefusal = 'recipient' | 'envelope' | 'replay' | 'document';

export class KerbwellGateRefusedError extends Error {
  constructor(readonly reason: KerbwellGateRefusal) {
    super(reason);
    this.name = 'KerbwellGateRefusedError';
  }
}

type OpenKerbwellGateSessionOptions = {
  claims: TKerbwellSignerAssertionClaims;
  requestMetadata: RequestMetadata;
  now?: Date;
};

/**
 * Turns a verified signer assertion into a gate session.
 *
 * The recipient (sub) must exist on the envelope the assertion names (env, by id or secondary
 * id), on a document that has been sent and not deleted. The jti is recorded first, in the same
 * transaction, so a second post of the same assertion is refused. Writes
 * KERBWELL_IDENTITY_VERIFIED every time and KERBWELL_CONSENT_GIVEN the first time this recipient
 * consents on a given consent version.
 *
 * Returns the cookie handle (shown once, never stored) and the recipient token for the redirect.
 */
export const openKerbwellGateSession = async ({
  claims,
  requestMetadata,
  now = new Date(),
}: OpenKerbwellGateSessionOptions) => {
  const recipientId = Number(claims.sub);

  const recipient = await prisma.recipient.findUnique({
    where: { id: recipientId },
    select: {
      id: true,
      token: true,
      email: true,
      name: true,
      role: true,
      envelopeId: true,
      envelope: {
        select: { id: true, secondaryId: true, status: true, deletedAt: true },
      },
    },
  });

  if (!recipient) {
    throw new KerbwellGateRefusedError('recipient');
  }

  if (claims.env !== recipient.envelope.id && claims.env !== recipient.envelope.secondaryId) {
    throw new KerbwellGateRefusedError('envelope');
  }

  if (recipient.envelope.deletedAt || recipient.envelope.status === DocumentStatus.DRAFT) {
    throw new KerbwellGateRefusedError('document');
  }

  const handle = randomBytes(32).toString('base64url');
  const authTime = new Date(claims.auth_time * 1000);
  const expiresAt = new Date(now.getTime() + KERBWELL_GATE_SESSION_TTL_SECONDS * 1000);

  const recipientData = {
    recipientEmail: recipient.email,
    recipientName: recipient.name,
    recipientId: recipient.id,
    recipientRole: recipient.role,
  };

  // The audit row's ipAddress/userAgent are this request (the browser at the gate). The ones
  // Kerbwell Identity saw at verification travel in the data.
  const auditRequestMetadata: RequestMetadata = {
    ipAddress: requestMetadata.ipAddress,
    userAgent: requestMetadata.userAgent,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.kerbwellGateAssertion.create({
        data: {
          jti: claims.jti,
          recipientId: recipient.id,
          envelopeId: recipient.envelopeId,
          expiresAt: new Date(claims.exp * 1000),
        },
      });

      const priorSessions = await tx.kerbwellGateSession.count({
        where: { recipientId: recipient.id },
      });

      const priorConsent = await tx.kerbwellGateSession.count({
        where: { recipientId: recipient.id, consentVersion: claims.consent_version, consentHash: claims.consent_hash },
      });

      // One live gate session per recipient: a fresh verification replaces the old one.
      await tx.kerbwellGateSession.updateMany({
        where: { recipientId: recipient.id, revokedAt: null },
        data: { revokedAt: now },
      });

      await tx.kerbwellGateSession.create({
        data: {
          tokenHash: hashKerbwellGateHandle(handle),
          recipientId: recipient.id,
          envelopeId: recipient.envelopeId,
          jti: claims.jti,
          authTime,
          acr: claims.acr,
          amr: claims.amr,
          consentVersion: claims.consent_version,
          consentHash: claims.consent_hash,
          idvRef: claims.idv_ref ?? null,
          legalName: claims.legal_name,
          docKind: claims.doc_kind,
          mode: claims.mode ?? null,
          ipAddress: claims.ip ?? null,
          userAgent: claims.ua ?? null,
          cfCity: claims.cf_city ?? null,
          expiresAt,
        },
      });

      await tx.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.KERBWELL_IDENTITY_VERIFIED,
          envelopeId: recipient.envelopeId,
          user: { name: recipient.name, email: recipient.email },
          requestMetadata: auditRequestMetadata,
          data: {
            ...recipientData,
            acr: claims.acr,
            amr: claims.amr,
            singleFactor: isSingleFactorAcr(claims.acr),
            assuranceLabel: KERBWELL_ACR_LABELS[claims.acr],
            authTime,
            idvReference: claims.idv_ref ?? null,
            assertionId: claims.jti,
            docKind: claims.doc_kind,
            mode: claims.mode ?? null,
            verifiedIpAddress: claims.ip ?? null,
            verifiedUserAgent: claims.ua ?? null,
            cfCity: claims.cf_city ?? null,
            reauthentication: priorSessions > 0,
          },
        }),
      });

      if (priorConsent === 0) {
        await tx.documentAuditLog.create({
          data: createDocumentAuditLogData({
            type: DOCUMENT_AUDIT_LOG_TYPE.KERBWELL_CONSENT_GIVEN,
            envelopeId: recipient.envelopeId,
            user: { name: recipient.name, email: recipient.email },
            requestMetadata: auditRequestMetadata,
            data: {
              ...recipientData,
              consentVersion: claims.consent_version,
              consentHash: claims.consent_hash,
              assertionId: claims.jti,
            },
          }),
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new KerbwellGateRefusedError('replay');
    }

    throw err;
  }

  return { handle, recipientToken: recipient.token, recipientId: recipient.id, expiresAt };
};

/**
 * The live gate session the Cookie header carries, or null: unknown, expired, revoked, or no
 * cookie at all.
 */
export const getKerbwellGateSession = async (
  cookieHeader: string | null | undefined,
  now = new Date(),
): Promise<KerbwellGateSession | null> => {
  const handle = readKerbwellGateCookie(cookieHeader);

  if (!handle) {
    return null;
  }

  const session = await prisma.kerbwellGateSession.findUnique({
    where: { tokenHash: hashKerbwellGateHandle(handle) },
  });

  if (!session || session.revokedAt || session.expiresAt <= now) {
    return null;
  }

  return session;
};

/**
 * The gate session for this recipient, or null when the cookie is missing or bound to anyone else.
 */
export const getKerbwellGateSessionForRecipient = async (
  cookieHeader: string | null | undefined,
  recipientId: number,
  now = new Date(),
) => {
  const session = await getKerbwellGateSession(cookieHeader, now);

  return session && session.recipientId === recipientId ? session : null;
};

/** Whether the identity verification behind a session is recent enough to Complete on. */
export const isKerbwellGateAuthFresh = (
  session: Pick<KerbwellGateSession, 'authTime'>,
  config: Pick<KerbwellGateConfig, 'maxAuthAgeSeconds'>,
  now = new Date(),
) => now.getTime() - session.authTime.getTime() <= config.maxAuthAgeSeconds * 1000;

/**
 * Where to send a signer whose verification is too old for Complete: Kerbwell Identity's signer
 * flow with prompt=login and max_age=0, for the same recipient and envelope. It verifies them again
 * and posts a fresh assertion back to /api/kerbwell/gate, which returns them to the document.
 */
export const buildKerbwellReauthUrl = (
  config: Pick<KerbwellGateConfig, 'reauthUrl'>,
  session: Pick<KerbwellGateSession, 'recipientId' | 'envelopeId'>,
) => {
  const url = new URL(config.reauthUrl);

  url.searchParams.set('prompt', 'login');
  url.searchParams.set('max_age', '0');
  url.searchParams.set('recipient', String(session.recipientId));
  url.searchParams.set('envelope', session.envelopeId);

  return url.toString();
};

/** Removes assertion and session rows well past their expiry. */
export const pruneKerbwellGateRows = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  await prisma.kerbwellGateAssertion.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  await prisma.kerbwellGateSession.deleteMany({ where: { expiresAt: { lt: cutoff } } });
};
