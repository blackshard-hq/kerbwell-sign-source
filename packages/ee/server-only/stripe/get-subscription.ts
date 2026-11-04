// Black Shard stub: billing is not part of this deployment. Community
// call sites (org creation, member changes) expect these to succeed as
// no-ops when billing is disabled, so none of them throw.
//
// The return type mirrors the commercial shape (Prisma Subscription row +
// Stripe subscription) structurally, without importing either package:
// the billing settings page pattern-matches on status/cancelAtPeriodEnd/
// periodEnd through tRPC type inference, and an `any` here degrades to
// `{}` on the client and breaks the typecheck.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export type GetSubscriptionOptions = any;

type StubOrganisationSubscription = {
  id: number;
  status: 'ACTIVE' | 'INACTIVE' | 'PAST_DUE';
  planId: string;
  priceId: string;
  periodEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
  cancelAtPeriodEnd: boolean;
  customerId: string;
  organisationId: string;
};

type StubStripeSubscription = {
  items: { data: Array<{ price: { product: unknown } }> };
};

export type GetSubscriptionResult = {
  organisationSubscription: StubOrganisationSubscription;
  stripeSubscription: StubStripeSubscription | null;
} | null;

export const getSubscription = async (..._args: any[]): Promise<GetSubscriptionResult> => null;
