'use client';
import { RouteError } from '@/components/route-error';
export default function SupportError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} area="Support" segment="support" />;
}
