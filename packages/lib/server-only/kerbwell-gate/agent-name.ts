import { prisma } from '@documenso/prisma';

/**
 * The agent a stranded signer should contact, for the "link no longer active" page.
 *
 * Kerbwell dispatch sets the envelope's reply-to address (documentMeta.emailReplyTo) to the
 * sending agent and adds the agent as a recipient (the counter-signer or a CC). The name comes
 * from that recipient. Without one it is null and the page says "the agent who sent it to you":
 * the sending account is the Kerbwell service account, not a person to contact.
 */
export const getKerbwellAgentNameForToken = async (token: string): Promise<string | null> => {
  const recipient = await prisma.recipient.findFirst({
    where: { token },
    select: {
      envelope: {
        select: {
          documentMeta: { select: { emailReplyTo: true } },
          recipients: { select: { email: true, name: true } },
        },
      },
    },
  });

  if (!recipient) {
    return null;
  }

  const { envelope } = recipient;
  const replyTo = envelope.documentMeta?.emailReplyTo?.trim().toLowerCase();

  if (!replyTo) {
    return null;
  }

  const agent = envelope.recipients.find((r) => r.email.toLowerCase() === replyTo && r.name.trim() !== '');

  return agent ? agent.name.trim() : null;
};
