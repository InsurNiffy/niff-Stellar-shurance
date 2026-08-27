'use client';

import { AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { Claim } from '@/lib/schemas/vote';

export interface AppealButtonProps {
  /** The claim to appeal */
  claim: Claim;
  /** Connected wallet address */
  walletAddress: string | null;
  /** Whether an appeal is currently being submitted */
  submitting?: boolean;
  /** Click handler to open the appeal confirmation modal */
  onClick: () => void;
  /** Optional CSS class */
  className?: string;
}

/**
 * AppealButton — shows an appeal button for rejected claims where the claimant
 * is the connected wallet.
 *
 * Only visible when:
 * - Claim status is 'Rejected'
 * - Connected wallet matches the claimant address
 * - Appeal has not already been submitted (checked by parent)
 */
export function AppealButton({
  claim,
  walletAddress,
  submitting = false,
  onClick,
  className,
}: AppealButtonProps) {
  const t = useTranslations('claims.appeal');

  // Only show for rejected claims
  if (claim.status !== 'Rejected') {
    return null;
  }

  // Only show if wallet is connected and matches claimant
  if (!walletAddress || walletAddress !== claim.claimant) {
    return null;
  }

  return (
    <div className={className}>
      <Button
        variant="outline"
        onClick={onClick}
        disabled={submitting}
        aria-label={t('buttonAriaLabel')}
        className="w-full sm:w-auto"
      >
        <AlertCircle className="mr-2 h-4 w-4" aria-hidden="true" />
        {submitting ? t('buttonSubmitting') : t('buttonLabel')}
      </Button>
    </div>
  );
}
