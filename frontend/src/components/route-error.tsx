'use client';

import { useEffect } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { resolveErrorMessage, getCorrelationId } from '@/lib/errors';
import { logRouteSegmentError } from '@/lib/observability';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
  area: string;
  /** Observability segment key (e.g. claims, policies, admin) */
  segment: string;
}

/**
 * Shared render for Next.js route-level error.tsx files.
 * Keeps feature-area error UIs consistent. Retry calls `reset()` so Next.js
 * re-renders the segment. Signing and other event-handler errors are not
 * caught here — handle those inline.
 */
export function RouteError({ error, reset, area, segment }: Props) {
  const isDev = process.env.NODE_ENV !== 'production';
  const correlationId = getCorrelationId(error) ?? error.digest;

  useEffect(() => {
    logRouteSegmentError({ segment, error });
  }, [error, segment]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center gap-4"
    >
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
      <div>
        <p className="font-semibold text-lg">{area} unavailable</p>
        <p className="text-muted-foreground text-sm mt-1">{resolveErrorMessage(error)}</p>
        {correlationId && (
          <p className="text-xs text-muted-foreground mt-2">
            Support reference: <code className="font-mono">{correlationId}</code>
          </p>
        )}
      </div>

      {isDev && (
        <details className="w-full max-w-xl text-left text-xs border rounded p-3 bg-muted">
          <summary className="cursor-pointer font-medium">Technical details (dev only)</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all opacity-80">
            {error.stack ?? error.message}
          </pre>
        </details>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="default" size="sm" onClick={() => reset()}>
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden />
          Try again
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <Home className="h-4 w-4 mr-2" aria-hidden />
            Go to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
