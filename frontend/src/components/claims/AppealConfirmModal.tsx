'use client';

import { useEffect, useRef } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { Claim } from '@/lib/schemas/vote';

export interface AppealConfirmModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** The claim being appealed */
  claim: Claim | null;
  /** Whether the appeal is currently being submitted */
  submitting: boolean;
  /** Callback when user confirms the appeal */
  onConfirm: () => void;
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
 */
export function AppealConfirmModal({
  open,
  claim,
  submitting,
  onConfirm,
  onCancel,
  triggerRef,
}: AppealConfirmModalProps) {
  // ── Focus return: restore focus to trigger element on close (#1339) ────────
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !open) {
      // Modal just closed — return focus to the button that opened it
      triggerRef?.current?.focus();
    }
    wasOpen.current = open;
  }, [open, triggerRef]);

  if (!claim) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !submitting && onCancel()}>
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

        <div className="space-y-4 py-4">
          {/* Appeal Rules */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="space-y-2 text-sm text-blue-900">
                <p className="font-semibold">Appeal Rules:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>
                    <strong>One appeal per claim:</strong> You can only appeal this decision once.
                  </li>
                  <li>
                    <strong>Elevated quorum:</strong> A higher percentage of voters must participate
                    for the appeal to be valid.
                  </li>
                  <li>
                    <strong>New voting window:</strong> A fresh voting period will open, allowing
                    all eligible voters to cast their vote again.
                  </li>
                  <li>
                    <strong>Final decision:</strong> The outcome of the appeal vote is final and
                    cannot be appealed again.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Claim Details */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Claim ID:</span>
              <span className="font-mono font-medium">#{claim.claim_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Status:</span>
              <span className="font-medium text-red-600">Rejected</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Policy ID:</span>
              <span className="font-mono">{claim.policy_id}</span>
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

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            className="w-full sm:w-auto"
            aria-label="Cancel appeal and close dialog"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={submitting}
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
