// Black Shard stub: billing is not part of this deployment. Community
// call sites (org creation, member changes) expect these to succeed as
// no-ops when billing is disabled, so none of them throw.
//
// InternalClaimPlans is typed structurally to match what BillingPlans
// renders (plan intervals -> price -> product.features); Record<string, any>
// leaks implicit-any into that component's map callbacks and fails the
// strict typecheck.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

type StubPlanPrice = {
  id: string;
  isVisibleInApp: boolean;
  friendlyPrice: string;
  product: {
    name: string;
    description: string | null;
    features?: Array<{ name?: string | null }> | null;
  };
};

export type InternalClaimPlans = Record<
  string,
  {
    id: string;
    name?: string;
    monthlyPrice?: StubPlanPrice;
    yearlyPrice?: StubPlanPrice;
  }
>;

export const getInternalClaimPlans = async (..._args: any[]): Promise<InternalClaimPlans> => ({});
