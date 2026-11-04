import type { KerbwellGateSession } from '@prisma/client';

import type { KerbwellGateConfig } from './config';

export const KERBWELL_SIGNER_ACTIONS = ['ask', 'decline', 'wrong-person', 'paper'] as const;

export type TKerbwellSignerAction = (typeof KERBWELL_SIGNER_ACTIONS)[number];

export type KerbwellSignerActionLinks = Record<TKerbwellSignerAction, string>;

/**
 * The "Something wrong?" links for a gate session: the portal actions page with the action, the
 * Documenso recipient id and the envelope id. The portal maps those back to its own gate record
 * and asks the signer to confirm there. Null when no actions page is configured.
 */
export const buildKerbwellSignerActionLinks = (
  config: Pick<KerbwellGateConfig, 'actionsUrl'>,
  session: Pick<KerbwellGateSession, 'recipientId' | 'envelopeId'>,
): KerbwellSignerActionLinks | null => {
  if (!config.actionsUrl) {
    return null;
  }

  const link = (action: TKerbwellSignerAction) => {
    const url = new URL(config.actionsUrl as string);

    url.searchParams.set('action', action);
    url.searchParams.set('recipient', String(session.recipientId));
    url.searchParams.set('envelope', session.envelopeId);

    return url.toString();
  };

  return {
    ask: link('ask'),
    decline: link('decline'),
    'wrong-person': link('wrong-person'),
    paper: link('paper'),
  };
};

/**
 * The passkey offer on the done page, for the same recipient and envelope. Never in kiosk mode
 * (an in-person signing on the agent's device): no passkey can be created there.
 */
export const buildKerbwellPasskeyOfferUrl = (
  config: Pick<KerbwellGateConfig, 'passkeyUrl'>,
  session: Pick<KerbwellGateSession, 'recipientId' | 'envelopeId' | 'mode'>,
) => {
  if (session.mode === 'in_person') {
    return null;
  }

  const url = new URL(config.passkeyUrl);

  url.searchParams.set('recipient', String(session.recipientId));
  url.searchParams.set('envelope', session.envelopeId);

  return url.toString();
};
