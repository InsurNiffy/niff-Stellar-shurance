'use client';

import { useState } from 'react';
import { useWallet } from '@/hooks/use-wallet';
import { getConfig } from '@/config/env';
import type { PolicyDto } from '../api';

interface Props {
  policy: PolicyDto;
  onClose: () => void;
}

/**
 * TerminateModal — warns the user that termination is irreversible and
 * requires an on-chain transaction. Calls the backend terminate endpoint.
 */
export function TerminateModal({ policy, onClose }: Props) {
  const { address, signTransaction } = useWallet();
  const { apiUrl } = getConfig();
  const [step, setStep] = useState<'confirm' | 'signing' | 'done' | 'error'>('confirm');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleConfirm() {
    if (!address) return;
    setStep('signing');
    try {
      // Build terminate transaction
      const buildRes = await fetch(`${apiUrl}/api/policies/${encodeURIComponent(policy.holder)}/${policy.policy_id}/terminate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address }),
      });
      if (!buildRes.ok) {
        const err = await buildRes.json().catch(() => ({ message: 'Terminate failed' }));
        throw new Error(err.message ?? 'Terminate failed');
      }
      const { transactionXdr } = (await buildRes.json()) as { transactionXdr: string };
      const signed = await signTransaction(transactionXdr);

      // Submit signed XDR
      const submitRes = await fetch(`${apiUrl}/api/policies/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionXdr: signed, signature: '' }),
      });
      if (!submitRes.ok) throw new Error('Submit failed');
      const { transactionHash } = (await submitRes.json()) as { transactionHash: string };
      setTxHash(transactionHash);
      setStep('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Termination failed');
      setStep('error');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Terminate Policy"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Terminate Policy</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {step === 'confirm' && (
          <div className="space-y-4">
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              ⚠️ Termination is <strong>irreversible</strong>. The policy will be deactivated
              on-chain and no further claims can be filed.
            </div>
            <p className="text-sm text-gray-700">
              You are about to terminate policy <strong>#{policy.policy_id}</strong>.
              This requires signing an on-chain transaction.
            </p>
            <p className="text-xs text-gray-400">
              ⓘ The dashboard may take up to 15 s to reflect the change due to indexer lag.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="min-h-[44px] rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                Sign &amp; Terminate
              </button>
            </div>
          </div>
        )}

        {step === 'signing' && (
          <p className="text-sm text-gray-600 py-4 text-center">Waiting for wallet signature…</p>
        )}

        {step === 'done' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-green-700 font-medium">Policy terminated ✓</p>
            {txHash && <p className="text-xs text-gray-500 break-all">Tx: {txHash}</p>}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Close
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-red-600">{errorMsg}</p>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
