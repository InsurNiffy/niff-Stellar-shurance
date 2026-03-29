'use client';

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createQueryClient } from './queryClientConfig';

interface QueryProviderProps {
  children: React.ReactNode;
}

/**
 * Wraps the app with a QueryClientProvider using the centralized config.
 * The QueryClient is created once per component mount (useState initializer)
 * so it is stable across re-renders but not shared across requests in SSR.
 *
 * DevTools are included only in development builds (tree-shaken in production).
 */
export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
