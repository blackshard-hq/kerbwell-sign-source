import type { KerbwellGateSigningContext as TKerbwellGateSigningContext } from '@documenso/lib/server-only/kerbwell-gate/enforce';
import { createContext, useContext } from 'react';

/**
 * Kerbwell gate session details for the signing UI (fork addition, Kerbwell Sign). The signing
 * route loader reads them from the gate session (packages/lib server-only/kerbwell-gate), never
 * from the client. Null when the gate is off.
 *
 * legalName    the CDD legal name; the typed signature defaults to it.
 * docKind      agency_agreement, engagement_letter, cdd_acknowledgement or general_non_prescribed;
 *              upload signatures are hidden for agency_agreement.
 * singleFactor true for acr kw-sign-l1-single.
 * kiosk        an in-person signing on the agent's device: no passkey offer.
 * actions      the portal "Something wrong?" links, or null (the panel then uses the fork's own
 *              decline and mails agentEmail).
 * passkeyUrl   the done page's passkey offer, null in kiosk mode.
 */
export type KerbwellGateSigningContextValue = TKerbwellGateSigningContext | null;

const KerbwellGateSigningContext = createContext<KerbwellGateSigningContextValue>(null);

export const KerbwellGateSigningProvider = KerbwellGateSigningContext.Provider;

export const useKerbwellGateSigning = () => useContext(KerbwellGateSigningContext);

export const KERBWELL_AGENCY_AGREEMENT = 'agency_agreement';

/** Upload signatures are never offered on an agency agreement. */
export const isKerbwellUploadAllowed = (gate: KerbwellGateSigningContextValue, uploadEnabled: boolean | undefined) =>
  gate?.docKind === KERBWELL_AGENCY_AGREEMENT ? false : (uploadEnabled ?? true);
