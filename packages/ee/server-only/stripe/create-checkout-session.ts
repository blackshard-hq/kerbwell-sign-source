// Black Shard stub: billing is not part of this deployment. Community
// call sites (org creation, member changes) expect these to succeed as
// no-ops when billing is disabled, so none of them throw.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export type CreateCheckoutSessionOptions = any;

export const createCheckoutSession = async (..._args: any[]): Promise<any> => {
  throw new Error('Billing is not available on this deployment.');
};
