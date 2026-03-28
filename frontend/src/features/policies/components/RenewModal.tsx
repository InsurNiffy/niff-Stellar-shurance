'use client';

import { useState } from 'react';
import { useWallet } from '@/hooks/use-wallet';
import { PolicyAPI } from '@/lib/api/policy';
import { formatXlm } from './PolicyItem';
import type { PolicyDto } from '../api';

interface Props {
  policy: PolicyDto;
  onClose: () => void;
}

/**
 * RenewModal — informs the user that renewal requires an on-chain transaction,
 * then initiates the policy flow (re-uses PolicyAPI.initiatePolicy with the
 * existing quoteId pattern; a real renewal endpoint would be wired here).
 *
 * Displayed when the policy is within the 30-day renewal window.
 */
export function RenewModal({ policy, onClose }: Props) {
  const { address, signTransaction } = useWallet();
  const [step, setStep] = useState<'confirm' | 'signing' | 'done' | 'error'>('confirm');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleConfirm() {
    if (!address) return;
    setStep('signing');
    try {
      // Initiate renewal transaction (backend builds the XDR)
      const tx = await PolicyAPI.initiatePolicy({
        quoteId: `renew:${policy.holder}:${policy.policy_id}`,
        walletAddress: address,
        acceptTerms: true,
      });
      const signed = await signTransaction(tx.transactionXdr);
      const result = await PolicyAPI.submitTransaction(signed, '');
      setTxHash(result.transactionHash);
      setStep('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Renewal failed');
      setStep('error');
    }
  }

  return (
    <Dialog title="Renew Policy" onClose={onClose}>
      {step === 'confirm' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Renewing policy <strong>#{policy.policy_id}</strong> requires an on-chain transaction
            on the Stellar network. Your wallet will prompt you to sign.
          </p>
          <dl className="text-sm space-y-1">
            <Row label="Coverage" value={`${formatXlm(policy.coverage_summary.coverage_amount)} ${policy.coverage_summary.currency}`} />
            <Row label="Annual premium" value={`${formatXlm(policy.coverage_summary.premium_amount)} ${policy.coverage_summary.currency}`} />
          </dl>
          <p className="text-xs text-gray-400">
            ⓘ The renewed policy will be recorded on-chain. The dashboard may take up to 15 s to
            reflect the change due to indexer lag.
          </p>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="button" onClick={handleConfirm} className="btn-primary">Sign &amp; Renew</button>
          </div>
        </div>
      )}
      {step === 'signing' && (
        <p className="text-sm text-gray-600 py-4 text-center">Waiting for wallet signature…</p>
      )}
      {step === 'done' && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-green-700 font-medium">Renewal submitted ✓</p>
          {txHash && (
            <p className="text-xs text-gray-500 break-all">Tx: {txHash}</p>
          )}
          <button type="button" onClick={onClose} className="btn-primary">Close</button>
        </div>
      )}
      {step === 'error' && (
        <div className="space-y-3 text-center">
          <p className="text-sm text-red-600">{errorMsg}</p>
          <button type="button" onClick={onClose} className="btn-secondary">Close</button>
        </div>
      )}
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
