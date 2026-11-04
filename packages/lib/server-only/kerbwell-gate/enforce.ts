import { prisma } from '@documenso/prisma';
import type { Envelope, KerbwellGateSession, Recipient } from '@prisma/client';

import { DocumentAuth } from '../../types/document-auth';
import { extractDocumentAuthMethods } from '../../utils/document-auth';
import { getKerbwellGateConfig, type KerbwellGateConfig } from './config';
import { getKerbwellGateSessionForRecipient, isKerbwellGateAuthFresh } from './session';
import {
  buildKerbwellPasskeyOfferUrl,
  buildKerbwellSignerActionLinks,
  type KerbwellSignerActionLinks,
} from './signer-ui';

/**
 * Whether this recipient may only be reached through the gate. Mode `all` covers every
 * recipient; mode `recipient` covers those whose derived access or action auth names KERBWELL_GATE.
 */
export const isKerbwellGateRequired = (
  config: KerbwellGateConfig | null,
  options: { documentAuth: Envelope['authOptions']; recipientAuth: Recipient['authOptions'] },
) => {
  if (!config) {
    return false;
  }

  if (config.mode === 'all') {
    return true;
  }

  const { derivedRecipientAccessAuth, derivedRecipientActionAuth } = extractDocumentAuthMethods(options);

  return (
    derivedRecipientAccessAuth.includes(DocumentAuth.KERBWELL_GATE) ||
    derivedRecipientActionAuth.includes(DocumentAuth.KERBWELL_GATE)
  );
};

export type KerbwellGateCheck =
  | { status: 'not_required' }
  | { status: 'unknown_token' }
  | { status: 'refused'; recipientId: number }
  | {
      status: 'allowed';
      recipientId: number;
      session: KerbwellGateSession;
      authFresh: boolean;
      config: KerbwellGateConfig;
    };

/**
 * The gate check for a recipient token, against the Cookie header of the request carrying it.
 * `unknown_token` is left to the caller's own not-found handling.
 */
export const checkKerbwellGateForToken = async ({
  token,
  cookieHeader,
  now = new Date(),
}: {
  token: string;
  cookieHeader: string | null | undefined;
  now?: Date;
}): Promise<KerbwellGateCheck> => {
  const config = getKerbwellGateConfig();

  if (!config) {
    return { status: 'not_required' };
  }

  const recipient = await prisma.recipient.findFirst({
    where: { token },
    select: {
      id: true,
      authOptions: true,
      envelope: { select: { authOptions: true } },
    },
  });

  if (!recipient) {
    return { status: 'unknown_token' };
  }

  if (
    !isKerbwellGateRequired(config, {
      documentAuth: recipient.envelope.authOptions,
      recipientAuth: recipient.authOptions,
    })
  ) {
    return { status: 'not_required' };
  }

  const session = await getKerbwellGateSessionForRecipient(cookieHeader, recipient.id, now);

  if (!session) {
    return { status: 'refused', recipientId: recipient.id };
  }

  return {
    status: 'allowed',
    recipientId: recipient.id,
    session,
    authFresh: isKerbwellGateAuthFresh(session, config, now),
    config,
  };
};

/**
 * Whether a request (by its Cookie header) holds a live gate session for this recipient. Used by
 * isRecipientAuthorized for the KERBWELL_GATE auth type.
 */
export const hasKerbwellGateSessionForRecipient = async (cookieHeader: string | null, recipientId: number) => {
  if (!getKerbwellGateConfig()) {
    return false;
  }

  return (await getKerbwellGateSessionForRecipient(cookieHeader, recipientId)) !== null;
};

/**
 * What the signing UI may know about the gate session: the typed signature defaults to the CDD
 * legal name, upload is hidden for agency agreements, the "Something wrong?" panel links to the
 * portal actions (or mails the agent), and the done page offers a passkey except in kiosk mode.
 */
export type KerbwellGateSigningContext = {
  legalName: string;
  docKind: string;
  acr: string;
  singleFactor: boolean;
  authTime: Date;
  kiosk: boolean;
  actions: KerbwellSignerActionLinks | null;
  agentEmail: string | null;
  passkeyUrl: string | null;
};

/**
 * The signing loaders' gate step. `refused` means the page must not render for this request.
 */
export const resolveKerbwellGateForSigning = async ({
  cookieHeader,
  recipient,
  documentAuth,
}: {
  cookieHeader: string | null;
  recipient: Pick<Recipient, 'id' | 'authOptions'>;
  documentAuth: Envelope['authOptions'];
}): Promise<{ refused: boolean; context: KerbwellGateSigningContext | null }> => {
  const config = getKerbwellGateConfig();

  if (!config) {
    return { refused: false, context: null };
  }

  const session = await getKerbwellGateSessionForRecipient(cookieHeader, recipient.id);

  if (!session) {
    return {
      refused: isKerbwellGateRequired(config, { documentAuth, recipientAuth: recipient.authOptions }),
      context: null,
    };
  }

  const meta = await prisma.documentMeta.findFirst({
    where: { envelope: { id: session.envelopeId } },
    select: { emailReplyTo: true },
  });

  return {
    refused: false,
    context: {
      legalName: session.legalName,
      docKind: session.docKind,
      acr: session.acr,
      singleFactor: session.acr === 'kw-sign-l1-single',
      authTime: session.authTime,
      kiosk: session.mode === 'in_person',
      actions: buildKerbwellSignerActionLinks(config, session),
      agentEmail: meta?.emailReplyTo?.trim() || null,
      passkeyUrl: buildKerbwellPasskeyOfferUrl(config, session),
    },
  };
};
