'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { submitTransaction } from '@/lib/api/tx';
import { buildAppealXdr } from '@/lib/api/appeals';
import type { Claim, ClaimStatus } from '@/lib/types/claim';

export interface AppealButtonProps {
  claim: Claim;
  /** Ledger sequence the connected wallet belongs to (claimant). */
  claimantAddress?: string | null;
  /** Current ledger sequence from the network. */
  currentLedger?: number;
  /** Ledger after which the appeal window closes. */
  appealOpenDeadlineLedger?: number;
  onSubmitted?: () => void;
}

const REJECTED: ClaimStatus = 'Rejected';

export function AppealCountdownBadge({
  currentLedger,
  appealOpenDeadlineLedger,
}: {
  currentLedger?: number;
  appealOpenDeadlineLedger?: number;
}) {
  const t = useTranslations('claims.appeal');

  const remaining = useMemo(() => {
    if (
      typeof currentLedger !== 'number' ||
      typeof appealOpenDeadlineLedger !== 'number'
    ) {
      return null;
    }
    return Math.max(0, appealOpenDeadlineLedger - currentLedger);
  }, [currentLedger, appealOpenDeadlineLedger]);

  if (remaining === null) return null;

  if (remaining === 0) {
    return (
      <Badge variant="destructive" data-testid="appeal-countdown-badge">
        {t('windowClosed')}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" data-testid="appeal-countdown-badge">
      {t('ledgersRemaining', { count: remaining })}
    </Badge>
  );
}

export function AppealConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const t = useTranslations('claims.appeal');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="appeal-confirm-modal">
        <DialogHeader>
          <DialogTitle>{t('confirmTitle')}</DialogTitle>
          <DialogDescription>{t('confirmDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>{t('elevatedQuorum')}</p>
          <p>{t('shorterDeadline')}</p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? t('submitting') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AppealButton({
  claim,
  claimantAddress,
  currentLedger,
  appealOpenDeadlineLedger,
  onSubmitted,
}: AppealButtonProps) {
  const t = useTranslations('claims.appeal');
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isClaimant =
    !!claimantAddress && claimantAddress === claim.claimant;

  const isRejected = claim.status === REJECTED;

  const withinWindow =
    typeof currentLedger === 'number' &&
    typeof appealOpenDeadlineLedger === 'number' &&
    currentLedger <= appealOpenDeadlineLedger;

  // Hidden to non-claimants entirely.
  if (!isClaimant) return null;

  const disabled = !isRejected || !withinWindow || submitting;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const xdr = await buildAppealXdr(claim.id);
      await submitTransaction(xdr);
      toast({ title: t('submitted') });
      setOpen(false);
      onSubmitted?.();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: t('submitFailed'),
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <AppealCountdownBadge
        currentLedger={currentLedger}
        appealOpenDeadlineLedger={appealOpenDeadlineLedger}
      />
      <Button
        variant="destructive"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="appeal-button"
      >
        {t('openAppeal')}
      </Button>
      <AppealConfirmModal
        open={open}
        onOpenChange={setOpen}
        onConfirm={handleConfirm}
        submitting={submitting}
      />
    </div>
  );
}

export default AppealButton;
