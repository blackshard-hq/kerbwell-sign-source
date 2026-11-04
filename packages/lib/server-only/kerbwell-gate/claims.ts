import { z } from 'zod';

/**
 * Assurance levels Kerbwell Identity issues for a signer.
 *
 * kw-sign-l1         second-channel one-time code (or a passkey bound to the same identity).
 * kw-sign-l1-single  one channel only: the link and the code reached the same channel. Labelled
 *                    single-factor everywhere, and refused for agency agreements.
 * kw-sign-l2         level 1 plus a FrankieOne identity match from the last 90 days.
 */
export const ZKerbwellAcrSchema = z.enum(['kw-sign-l1', 'kw-sign-l1-single', 'kw-sign-l2']);

export const KERBWELL_SINGLE_FACTOR_ACR = 'kw-sign-l1-single';

export const ZKerbwellDocKindSchema = z.enum([
  'agency_agreement',
  'engagement_letter',
  'cdd_acknowledgement',
  'general_non_prescribed',
]);

const boundedString = (max: number) => z.string().trim().min(1).max(max);

/**
 * The signer assertion's claims, after the signature, issuer, audience and expiry checks.
 *
 * sub is the Documenso recipient id; env is the envelope id (either `envelope_...` or the
 * `document_<n>` secondary id).
 */
export const ZKerbwellSignerAssertionClaimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().regex(/^[0-9]{1,12}$/),
  env: boundedString(128),
  jti: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  iat: z.number().int(),
  exp: z.number().int(),
  auth_time: z.number().int(),
  acr: ZKerbwellAcrSchema,
  amr: z.array(boundedString(32)).min(1).max(8),
  consent_version: boundedString(64),
  consent_hash: z.string().regex(/^[a-f0-9]{64}$/),
  idv_ref: boundedString(128).nullish(),
  legal_name: boundedString(200),
  doc_kind: ZKerbwellDocKindSchema,
  ip: boundedString(64).nullish(),
  ua: boundedString(512).nullish(),
  cf_city: boundedString(128).nullish(),
  mode: z.enum(['remote', 'in_person']).nullish(),
});

export type TKerbwellSignerAssertionClaims = z.infer<typeof ZKerbwellSignerAssertionClaimsSchema>;
export type TKerbwellAcr = z.infer<typeof ZKerbwellAcrSchema>;
export type TKerbwellDocKind = z.infer<typeof ZKerbwellDocKindSchema>;

export const isSingleFactorAcr = (acr: string) => acr === KERBWELL_SINGLE_FACTOR_ACR;
