'use client';

/**
 * Route protection for authenticated pages (#1507).
 *
 * Unauthenticated visitors are redirected to `loginTo` with a `next` param so
 * they land back on the original page after signing in. While the session is
 * resolving we render `fallback` instead of flashing protected content.
 */

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useSession, UseSessionOptions } from '../hooks/useSession';

export interface RequireAuthProps {
  children: ReactNode;
  /** Where to send unauthenticated users (default: /login). */
  loginTo?: string;
  /** Rendered while the session is resolving. */
  fallback?: ReactNode;
  sessionOptions?: UseSessionOptions;
}

export function RequireAuth({
  children,
  loginTo = '/login',
  fallback = null,
  sessionOptions,
}: RequireAuthProps) {
  const { status } = useSession(sessionOptions);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status !== 'unauthenticated') return;
    const query = searchParams?.toString();
    const next = encodeURIComponent(query ? `${pathname}?${query}` : pathname);
    router.replace(`${loginTo}?next=${next}`);
  }, [status, router, pathname, searchParams, loginTo]);

  if (status === 'loading') return <>{fallback}</>;
  if (status !== 'authenticated') return <>{fallback}</>;
  return <>{children}</>;
}
