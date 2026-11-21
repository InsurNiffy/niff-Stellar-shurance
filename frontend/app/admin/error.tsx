'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/** Route-level boundary: admin errors stay inside the admin segment. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log only anonymized metadata — never the message or stack (may contain PII).
    console.error('[admin:error]', {
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main role="alert" className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Admin unavailable</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The admin section could not be displayed. The rest of the app is still available.
      </p>
      {error.digest && <p className="mt-2 text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Retry
        </button>
        <Link href="/dashboard" className="rounded-md border px-4 py-2 text-sm font-medium">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
