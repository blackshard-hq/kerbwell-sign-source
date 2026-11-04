import { getBaseUrl } from '@documenso/lib/universal/get-base-url';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, httpLink, isNonJsonSerializable, splitLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { useMemo, useState } from 'react';

import type { AppRouter } from '../server/router';
import { dataTransformer } from '../utils/data-transformer';

export { getQueryKey } from '@trpc/react-query';

export const trpc = createTRPCReact<AppRouter>({
  overrides: {
    useMutation: {
      async onSuccess(opts) {
        await opts.originalFn();

        if (opts.meta.doNotInvalidateQueryOnMutation) {
          return;
        }

        // Invalidate all queries besides ones that specify not to in the meta data.
        await opts.queryClient.invalidateQueries({
          predicate: (query) => !query?.meta?.doNotInvalidateQueryOnMutation,
        });
      },
    },
  },
});

/**
 * Kerbwell gate (fork addition, Kerbwell Sign): Complete answers KERBWELL_REAUTH_REQUIRED when the
 * signer's identity verification is older than 15 minutes, with the Kerbwell Identity URL to verify
 * again. Any mutation that gets it sends the browser there; the fresh assertion brings the signer
 * back to the same document with their fields kept.
 */
const KERBWELL_REAUTH_REQUIRED = 'KERBWELL_REAUTH_REQUIRED';

export const getKerbwellReauthUrl = (error: unknown): string | null => {
  if (!error || typeof error !== 'object' || !('data' in error)) {
    return null;
  }

  const data = (error as { data?: { appError?: { code?: unknown; userMessage?: unknown } } }).data;
  const appError = data?.appError;

  if (appError?.code !== KERBWELL_REAUTH_REQUIRED || typeof appError.userMessage !== 'string') {
    return null;
  }

  try {
    const url = new URL(appError.userMessage);

    return url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

const createQueryClient = () =>
  new QueryClient({
    mutationCache: new MutationCache({
      onError: (error) => {
        const reauthUrl = getKerbwellReauthUrl(error);

        if (reauthUrl && typeof window !== 'undefined') {
          window.location.assign(reauthUrl);
        }
      },
    }),
  });

export interface TrpcProviderProps {
  children: React.ReactNode;
  headers?: Record<string, string>;
}

export function TrpcProvider({ children, headers }: TrpcProviderProps) {
  const [queryClient] = useState(createQueryClient);

  // May cause remounting issues.
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [
          splitLink({
            condition: (op) => op.context.skipBatch === true || isNonJsonSerializable(op.input),
            true: httpLink({
              url: `${getBaseUrl()}/api/trpc`,
              headers,
              transformer: dataTransformer,
            }),
            false: httpBatchLink({
              url: `${getBaseUrl()}/api/trpc`,
              headers,
              transformer: dataTransformer,
            }),
          }),
        ],
      }),
    [headers],
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
