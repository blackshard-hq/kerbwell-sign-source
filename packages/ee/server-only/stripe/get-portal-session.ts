// Black Shard stub: billing is not part of this deployment. Community
// call sites (org creation, member changes) expect these to succeed as
// no-ops when billing is disabled, so none of them throw.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export type GetPortalSessionOptions = any;

export const getPortalSession = async (..._args: any[]): Promise<any> => {
  throw new Error('Billing is not available on this deployment.');
};
