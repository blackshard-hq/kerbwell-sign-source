// Black Shard stub: billing is not part of this deployment. Community
// call sites (org creation, member changes) expect these to succeed as
// no-ops when billing is disabled, so none of them throw.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export type SyncStripeCustomerSubscriptionOptions = any;

export const syncStripeCustomerSubscription = async (..._args: any[]): Promise<any> => null;

export const extractStripeClaimId = (..._args: any[]): any => null;

export const extractStripeClaim = (..._args: any[]): any => null;
