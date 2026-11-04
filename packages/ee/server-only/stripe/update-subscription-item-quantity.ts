// Black Shard stub: billing is not part of this deployment. Community
// call sites (org creation, member changes) expect these to succeed as
// no-ops when billing is disabled, so none of them throw.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export type UpdateSubscriptionItemQuantityOptions = any;

export const updateSubscriptionItemQuantity = async (..._args: any[]): Promise<any> => null;

export const assertMemberCountWithinCap = async (..._args: any[]): Promise<void> => undefined;

export const syncMemberCountWithStripeSeatPlan = async (..._args: any[]): Promise<any> => null;

export const reconcileSeatBasedPlans = async (..._args: any[]): Promise<any> => null;
