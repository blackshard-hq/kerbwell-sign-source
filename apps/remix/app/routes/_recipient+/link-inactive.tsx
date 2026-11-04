import { KerbwellLinkInactivePage } from '~/components/general/kerbwell/link-inactive-page';

import type { Route } from './+types/link-inactive';

/**
 * Kerbwell gate: a direct template link under the gate, a file request without a gate session,
 * or a refused signer assertion (?reason=retry).
 */
export function loader({ request }: Route.LoaderArgs) {
  const reason = new URL(request.url).searchParams.get('reason') === 'retry' ? 'retry' : 'inactive';

  return { reason } as const;
}

export default function KerbwellLinkInactive({ loaderData }: Route.ComponentProps) {
  return <KerbwellLinkInactivePage reason={loaderData.reason} />;
}
