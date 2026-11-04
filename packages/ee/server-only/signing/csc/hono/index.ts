import { Hono } from 'hono';

// Black Shard stub: the CSC signing sub-app is not part of this deployment.
export const csc = new Hono().all('*', (c) =>
  c.json({ error: 'CSC signing is not available on this deployment.' }, 501),
);

export type CscAppType = typeof csc;
