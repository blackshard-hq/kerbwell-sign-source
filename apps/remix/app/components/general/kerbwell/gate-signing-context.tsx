import { createContext, useContext } from 'react';

/**
 * Kerbwell gate session details for the signing UI (fork addition, Kerbwell Sign). The signing
 * route loader reads them from the gate session (packages/lib server-only/kerbwell-gate), never
 * from the client. Null when the gate is off.
 *
 * legalName  the CDD legal name; the typed signature defaults to it.
 * docKind    agency_agreement, engagement_letter, cdd_acknowledgement or general_non_prescribed;
 *            upload signatures are hidden for agency_agreement.
 * singleFactor true for acr kw-sign-l1-single.
 */
export type KerbwellGateSigningContextValue = {
  legalName: string;
  docKind: string;
  acr: string;
  singleFactor: boolean;
  authTime: Date;
} | null;

const KerbwellGateSigningContext = createContext<KerbwellGateSigningContextValue>(null);

export const KerbwellGateSigningProvider = KerbwellGateSigningContext.Provider;

export const useKerbwellGateSigning = () => useContext(KerbwellGateSigningContext);
