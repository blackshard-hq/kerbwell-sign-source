// Black Shard stub: the CSC/TSP signing transport is not part of this
// deployment (NEXT_PRIVATE_SIGNING_TRANSPORT is 'local').
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
const unavailable = (): never => {
  throw new Error('CSC signing is not available on this deployment.');
};

export type ExecuteTspSignOptions = any;
export type ExecuteTspSignResult = any;

export const executeTspSign = async (..._args: any[]): Promise<any> => unavailable();
