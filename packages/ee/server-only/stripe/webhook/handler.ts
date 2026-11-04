// Black Shard stub: billing is not part of this deployment. Community
// call sites (org creation, member changes) expect these to succeed as
// no-ops when billing is disabled, so none of them throw.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export const stripeWebhookHandler = async (_req: Request): Promise<Response> => {
  return Response.json({ error: 'Billing is not available on this deployment.' }, { status: 501 });
};
