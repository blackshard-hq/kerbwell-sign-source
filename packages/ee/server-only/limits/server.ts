import { prisma } from '@documenso/prisma';

import { SELFHOSTED_PLAN_LIMITS } from './constants';
import { ERROR_CODES } from './errors';
import type { TLimitsResponseSchema } from './schema';

export type GetServerLimitsOptions = {
  userId: number;
  teamId: number;
};

/**
 * Black Shard self-host limits: membership is still verified, quotas are
 * unlimited. The envelope item cap comes from the organisation claim so the
 * editor keeps its configured ceiling.
 */
export const getServerLimits = async ({
  userId,
  teamId,
}: GetServerLimitsOptions): Promise<TLimitsResponseSchema> => {
  const organisation = await prisma.organisation.findFirst({
    where: {
      teams: {
        some: {
          id: teamId,
        },
      },
      members: {
        some: {
          userId,
        },
      },
    },
    include: {
      organisationClaim: true,
    },
  });

  if (!organisation) {
    throw new Error(ERROR_CODES.USER_FETCH_FAILED);
  }

  return {
    quota: SELFHOSTED_PLAN_LIMITS,
    remaining: SELFHOSTED_PLAN_LIMITS,
    maximumEnvelopeItemCount: organisation.organisationClaim.envelopeItemCount,
  };
};
