// Black Shard stub: billing is not part of this deployment. Community
// call sites (org creation, member changes) expect these to succeed as
// no-ops when billing is disabled, so none of them throw.
//
// The item type mirrors the Stripe invoice fields the enterprise router
// maps over; an untyped `any` here makes that map's parameter an implicit
// any and fails the strict typecheck.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export type GetInvoicesOptions = any;

type StubInvoice = {
  id: string;
  status: string | null;
  created: number;
  currency: string;
  total: number;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

export const getInvoices = async (..._args: any[]): Promise<{ data: StubInvoice[] }> => ({
  data: [],
});
