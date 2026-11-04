import {
  assertMemberCountWithinCap,
  syncMemberCountWithStripeSeatPlan,
} from '@documenso/ee/server-only/stripe/update-subscription-item-quantity';
import { prisma } from '@documenso/prisma';
import type { OrganisationGroup, OrganisationMemberRole } from '@prisma/client';
import { OrganisationGroupType, OrganisationMemberInviteStatus, SubscriptionStatus } from '@prisma/client';

import { IS_BILLING_ENABLED } from '../../constants/app';
import { AppError, AppErrorCode } from '../../errors/app-error';
import { jobs } from '../../jobs/client';
import { generateDatabaseId } from '../../universal/id';

export type AcceptOrganisationInvitationOptions = {
  token: string;
};

export const acceptOrganisationInvitation = async ({ token }: AcceptOrganisationInvitationOptions) => {
  const organisationMemberInvite = await prisma.organisationMemberInvite.findFirst({
    where: {
      token,
      status: {
        not: OrganisationMemberInviteStatus.DECLINED,
      },
    },
    include: {
      organisation: {
        include: {
          groups: true,
          organisationClaim: true,
          subscription: true,
          members: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!organisationMemberInvite) {
    throw new AppError(AppErrorCode.NOT_FOUND);
  }

  // The OrganisationMemberInvite model has no expiresAt, so an invite token never
  // expired: a leaked/forwarded/years-old link stayed a live "join this org"
  // credential forever. Bound the lifetime by age. A properly migrated expiresAt
  // set at creation time is the fuller fix; this closes the hole without a schema
  // change. Treat an aged-out invite as not-found (do not leak existence).
  const inviteMaxAgeMs =
    Number(process.env.NEXT_PRIVATE_ORG_INVITE_MAX_AGE_DAYS || '30') * 24 * 60 * 60 * 1000;

  if (Date.now() - organisationMemberInvite.createdAt.getTime() > inviteMaxAgeMs) {
    throw new AppError(AppErrorCode.NOT_FOUND);
  }

  if (organisationMemberInvite.status === OrganisationMemberInviteStatus.ACCEPTED) {
    return;
  }

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: organisationMemberInvite.email,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'User must exist to accept an organisation invitation',
    });
  }

  const { organisation } = organisationMemberInvite;

  const isUserPartOfOrganisation = await prisma.organisationMember.findFirst({
    where: {
      userId: user.id,
      organisationId: organisation.id,
    },
  });

  if (isUserPartOfOrganisation) {
    return;
  }

  const newMemberCount = organisation.members.length + 1;

  // Billing occurs when a user accepts an invite.
  // Assert that the new member count is within the cap and sync the seat plan with Stripe.
  if (IS_BILLING_ENABLED()) {
    const { subscription, organisationClaim } = organisation;

    // A canceled subscription cannot have its seat quantity updated in Stripe,
    // and an organisation with lapsed billing should not gain new members.
    // Throw a deliberate error so the invite page can render an accurate
    // message instead of an opaque Stripe failure.
    if (subscription && subscription.status === SubscriptionStatus.INACTIVE) {
      throw new AppError('SUBSCRIPTION_INACTIVE', {
        message: 'The organisation subscription is inactive',
      });
    }

    // Organisations can exist without a subscription (e.g. after being
    // downgraded to the free plan). The claim cap remains authoritative in
    // that case, surfacing LIMIT_EXCEEDED instead of an opaque "subscription
    // not found" error.
    await assertMemberCountWithinCap(subscription, organisationClaim, newMemberCount);

    if (subscription) {
      await syncMemberCountWithStripeSeatPlan(subscription, organisationClaim, newMemberCount, 'grow');
    }
  }

  // Todo: Logging
  await addUserToOrganisation({
    userId: user.id,
    organisationId: organisation.id,
    organisationGroups: organisation.groups,
    organisationMemberRole: organisationMemberInvite.organisationRole,
  });

  await prisma.organisationMemberInvite.update({
    where: {
      id: organisationMemberInvite.id,
    },
    data: {
      status: OrganisationMemberInviteStatus.ACCEPTED,
    },
  });
};

export const addUserToOrganisation = async ({
  userId,
  organisationId,
  organisationGroups,
  organisationMemberRole,
  bypassEmail = false,
}: {
  userId: number;
  organisationId: string;
  organisationGroups: OrganisationGroup[];
  organisationMemberRole: OrganisationMemberRole;
  bypassEmail?: boolean;
}) => {
  const organisationGroupToUse = organisationGroups.find(
    (group) =>
      group.type === OrganisationGroupType.INTERNAL_ORGANISATION && group.organisationRole === organisationMemberRole,
  );

  if (!organisationGroupToUse) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'Organisation group not found',
    });
  }

  await prisma.organisationMember.create({
    data: {
      id: generateDatabaseId('member'),
      userId,
      organisationId,
      organisationGroupMembers: {
        create: {
          id: generateDatabaseId('group_member'),
          groupId: organisationGroupToUse.id,
        },
      },
    },
  });

  if (!bypassEmail) {
    await jobs.triggerJob({
      name: 'send.organisation-member-joined.email',
      payload: {
        organisationId,
        memberUserId: userId,
      },
    });
  }
};
