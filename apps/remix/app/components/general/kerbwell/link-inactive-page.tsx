import { Trans } from '@lingui/react/macro';
import { LinkIcon } from 'lucide-react';

export type KerbwellLinkInactivePageProps = {
  /** The sending agent's name, when the envelope names one. */
  agentName?: string | null;
  /** `inactive`: a signing link opened without a Kerbwell sign-in. `retry`: the sign-in was refused. */
  reason?: 'inactive' | 'retry';
};

/**
 * Kerbwell gate (fork addition, Kerbwell Sign): the page a signing link shows on its own, without
 * the identity check from Kerbwell, and after a refused or expired check.
 */
export const KerbwellLinkInactivePage = ({ agentName, reason = 'inactive' }: KerbwellLinkInactivePageProps) => {
  return (
    <div className="flex flex-col items-center px-4 pt-24 lg:pt-36 xl:pt-44" data-testid="kerbwell-link-inactive">
      <div className="flex flex-col items-center">
        <LinkIcon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />

        <h1 className="mt-6 max-w-[35ch] text-center font-semibold text-2xl leading-normal md:text-3xl">
          {reason === 'retry' ? (
            <Trans>We could not confirm it is you</Trans>
          ) : (
            <Trans>This link is no longer active</Trans>
          )}
        </h1>

        <p className="mt-4 max-w-[52ch] text-center text-muted-foreground text-sm md:text-base">
          {reason === 'retry' ? (
            <Trans>
              Open the link in your message again to continue. If this keeps happening, contact the agent who sent it to
              you.
            </Trans>
          ) : agentName ? (
            <Trans>Contact {agentName} for a new link.</Trans>
          ) : (
            <Trans>Contact the agent who sent it to you for a new link.</Trans>
          )}
        </p>
      </div>
    </div>
  );
};
