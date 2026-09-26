'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Bell, Info, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { Claim } from '@/lib/schemas/vote';

export interface AppealConfirmModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** The claim being appealed */
  claim: Claim | null;
  /** Whether the appeal is currently being submitted */
  submitting: boolean;
  /**
   * The wallet address at the time the modal was opened.
   * Used to detect mid-flow wallet switches before signing.
   */
  walletAddress?: string | null;
  /**
   * Callback when user confirms the appeal.
   * @param notifyOnOutcome - true if the claimant opted into appeal-outcome notifications
   */
  onConfirm: (notifyOnOutcome: boolean) => void;
  /** Callback when user cancels */
  onCancel: () => void;
  /** Ref to the element that triggered the modal — focus returns here on close (#1339) */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * AppealConfirmModal — confirmation dialog explaining appeal rules before submission.
 *
 * Accessibility (#1339):
 *  - aria-modal, aria-labelledby, aria-describedby matching VoteConfirmModal pattern
 *  - onEscapeKeyDown blocked during submission (mirrors VoteConfirmModal)
 *  - Focus returns to triggerRef element on close
 *
 * Appeal Rules:
 * - Only one appeal allowed per claim
 * - Elevated quorum requirement (higher threshold for approval)
 * - New voting window opens after appeal submission
 * - All eligible voters can participate in the appeal vote
 *
 * Also offers an opt-in toggle for push/email notification when the appeal
 * round resolves, so claimants don't have to poll (#1345).
 *
 * Wallet-mismatch guard (#1342):
 * - Snapshots the wallet address when the modal opens.
 * - Re-checks the current walletAddress prop immediately before calling onConfirm.
 * - Shows an error and blocks submission if the address changed mid-flow.
 */
export function AppealConfirmModal({
  open,
  claim,
  submitting,
  walletAddress = null,
  onConfirm,
  onCancel,
  triggerRef: _triggerRef,
}: AppealConfirmModalProps) {
  const t = useTranslations('claims.appeal');
  const [notifyOnOutcome, setNotifyOnOutcome] = useState(true);

  // #1342 — snapshot the wallet address when the modal first opens so we can
  // detect a mid-flow wallet switch before the user hits Confirm.
  const [snapshotAddress, setSnapshotAddress] = useState<string | null>(null);
  const [walletMismatch, setWalletMismatch] = useState(false);

  useEffect(() => {
    if (open) {
      // Capture the address at open-time; clear any stale mismatch state.
      setSnapshotAddress(walletAddress);
      setWalletMismatch(false);
    }
  }, [open, walletAddress]);

  // Re-evaluate mismatch whenever walletAddress changes while the modal is open.
  useEffect(() => {
    if (open && snapshotAddress !== null && walletAddress !== snapshotAddress) {
      setWalletMismatch(true);
    }
  }, [open, walletAddress, snapshotAddress]);

  if (!claim) return null;

  function handleConfirm() {
    // Final guard: re-check wallet address hasn't changed since modal opened.
    if (walletAddress !== snapshotAddress) {
      setWalletMismatch(true);
      return;
    }
    onConfirm(notifyOnOutcome);
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !submitting && onCancel()}>
      {/*
        #1341 — Mobile layout fixes:
        - max-h + overflow-y-auto on DialogContent so tall content scrolls on small viewports
          instead of overflowing off-screen.
        - Replaced fixed sm:max-w-md with a responsive max-w that also works at xs.
        - p-4 sm:p-6 gives tighter padding on small screens.
        - The rule list now uses break-words to prevent long words from overflowing.
      */}
      <DialogContent
        className="sm:max-w-md"
        aria-modal="true"
        aria-labelledby="appeal-confirm-title"
        aria-describedby="appeal-confirm-desc"
        onEscapeKeyDown={(e) => {
          // Prevent ESC during submission to avoid accidental cancellation
          // — mirrors VoteConfirmModal pattern (#1339)
          if (submitting) {
            e.preventDefault();
          } else {
            onCancel();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle
            id="appeal-confirm-title"
            className="flex items-center gap-2"
          >
            <AlertTriangle className="h-5 w-5 text-yellow-600" aria-hidden="true" />
            Appeal Claim Decision
          </DialogTitle>
          <DialogDescription id="appeal-confirm-desc">
            Review the appeal rules before submitting your appeal for claim #{claim.claim_id}.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 py-4">
          {/* #1342 — wallet-mismatch error banner */}
          {walletMismatch && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">{t('walletMismatchTitle')}</p>
                <p>{t('walletMismatchError')}</p>
              </div>
            </div>
          )}

          {/* Appeal Rules */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" aria-hidden="true" />
              {/* #1341 — break-words prevents long rule text from overflowing on mobile */}
              <div className="min-w-0 space-y-2 text-sm text-blue-900 break-words">
                <p className="font-semibold">{t('rulesHeading')}</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>{t('rule1Label')}</strong>{' '}
                    {t('rule1Detail')}
                  </li>
                  <li>
                    <strong>{t('rule2Label')}</strong>{' '}
                    {t('rule2Detail')}
                  </li>
                  <li>
                    <strong>{t('rule3Label')}</strong>{' '}
                    {t('rule3Detail')}
                  </li>
                  <li>
                    <strong>{t('rule4Label')}</strong>{' '}
                    {t('rule4Detail')}
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Claim Details */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-muted-foreground">{t('detailsClaimId')}</span>
              <span className="truncate text-right font-mono font-medium">#{claim.claim_id}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-muted-foreground">{t('detailsStatus')}</span>
              <span className="font-medium text-red-600">{t('detailsStatusValue')}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-muted-foreground">{t('detailsPolicyId')}</span>
              <span className="truncate text-right font-mono">{claim.policy_id}</span>
            </div>
          </div>

          {/* Appeal outcome notification opt-in (#1345) */}
          <div className="rounded-lg border border-muted bg-muted/30 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-2.5">
                <Bell className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
                <div className="min-w-0 space-y-0.5">
                  <Label
                    htmlFor="appeal-notify-toggle"
                    className="cursor-pointer text-sm font-medium"
                  >
                    {t('notifyLabel')}
                  </Label>
                  <p
                    id="appeal-notify-desc"
                    className="text-xs text-muted-foreground break-words"
                  >
                    {t('notifyDesc')}
                  </p>
                </div>
              </div>
              {/* Toggle switch */}
              <button
                id="appeal-notify-toggle"
                type="button"
                role="switch"
                aria-checked={notifyOnOutcome}
                aria-describedby="appeal-notify-desc"
                disabled={submitting}
                onClick={() => setNotifyOnOutcome((v) => !v)}
                className={[
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                  'transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  notifyOnOutcome ? 'bg-primary' : 'bg-input',
                  submitting ? 'opacity-40 cursor-not-allowed' : '',
                ].join(' ')}
              >
                <span className="sr-only">
                  {notifyOnOutcome
                    ? t('notifyDisableAriaLabel')
                    : t('notifyEnableAriaLabel')}
                </span>
                <span
                  aria-hidden="true"
                  className={[
                    'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
                    notifyOnOutcome ? 'translate-x-5' : 'translate-x-0',
                  ].join(' ')}
                />
              </button>
            </div>
          </div>

          {/* Warning */}
          <div
            role="note"
            className="rounded-lg border border-yellow-200 bg-yellow-50 p-3"
          >
            <p className="text-xs text-yellow-900">
              <AlertTriangle className="inline h-3 w-3 mr-1" aria-hidden="true" />
              <strong>Important:</strong> Submitting an appeal will require you to sign a
              transaction with your wallet. Make sure you understand the appeal rules before
              proceeding.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            className="w-full sm:w-auto"
            aria-label="Cancel appeal and close dialog"
          >
            {t('cancelButton')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting || walletMismatch}
            className="w-full sm:w-auto"
            aria-label="Confirm and submit appeal"
            aria-busy={submitting}
          >
            {submitting ? 'Submitting…' : 'Confirm & Submit Appeal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
