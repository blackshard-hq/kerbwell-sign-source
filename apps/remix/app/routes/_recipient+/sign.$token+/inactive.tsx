import { getKerbwellAgentNameForToken } from '@documenso/lib/server-only/kerbwell-gate';

import { KerbwellLinkInactivePage } from '~/components/general/kerbwell/link-inactive-page';

import type { Route } from './+types/inactive';

/**
 * Kerbwell gate: where a signing link opened without a gate session lands (server/api
 * kerbwell-gate.ts). Shows nothing of the document, only who to contact.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const agentName = params.token ? await getKerbwellAgentNameForToken(params.token).catch(() => null) : null;

  return { agentName };
}

export default function KerbwellSigningLinkInactive({ loaderData }: Route.ComponentProps) {
  return <KerbwellLinkInactivePage agentName={loaderData.agentName} />;
}
