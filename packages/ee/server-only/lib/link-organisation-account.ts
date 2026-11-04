// Black Shard stub: this enterprise feature is not part of this
// deployment. Reaching it is an explicit admin action, so it fails loud.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
const unavailable = (feature: string) => {
  throw new Error(`${feature} is not available on this deployment.`);
};

export interface LinkOrganisationAccountOptions {
  [key: string]: any;
}

export const linkOrganisationAccount = async (..._args: any[]): Promise<any> =>
  unavailable('Organisation account linking');
