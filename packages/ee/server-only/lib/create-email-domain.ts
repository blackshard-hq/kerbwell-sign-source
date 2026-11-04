// Black Shard stub: this enterprise feature is not part of this
// deployment. Reaching it is an explicit admin action, so it fails loud.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
const unavailable = (feature: string) => {
  throw new Error(`${feature} is not available on this deployment.`);
};

export const getSesClient = (..._args: any[]): any => unavailable('Email domains');

export async function verifyDomainWithDKIM(
  _domain: string,
  _selector: string,
  _privateKey: string,
): Promise<any> {
  return unavailable('Email domains');
}

export const createEmailDomain = async (..._args: any[]): Promise<any> =>
  unavailable('Email domains');
