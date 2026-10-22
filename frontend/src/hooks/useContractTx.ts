import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { signTransaction } from '@stellar/freighter-api';
import { SorobanRpc, TransactionBuilder, Networks } from '@stellar/stellar-sdk';
import { getConfig } from '@/config/env';
import { stellarExpertUrl } from '@/features/wallet/utils/stellarExpert';

/**
 * Lifecycle states for an on-chain contract transaction.
 * idle -> building -> awaiting-signature -> submitting -> confirming -> success | error
 */
export type ContractTxState =
  | 'idle'
  | 'building'
  | 'awaiting-signature'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'error';

/**
 * Error classes surfaced to the UI so it can render a helpful message and
 * decide whether a retry makes sense.
 */
export type ContractTxErrorKind =
  | 'user-rejected'
  | 'insufficient-balance'
  | 'simulation-failed'
  | 'timeout'
  | 'unknown';

export interface ContractTxError {
  kind: ContractTxErrorKind;
  message: string;
  /** Raw contract error code when the failure came from simulation. */
  code?: number;
  /** Whether the user can safely retry the same operation. */
  retryable: boolean;
  xdrError?: string;
}

export interface ContractTxResult {
  hash: string;
  explorerUrl: string;
}

export interface UseContractTxOptions {
  /**
   * Builds the unsigned transaction XDR. Called on every attempt so a retry
   * always starts from a fresh sequence number / ledger state.
   */
  build: () => Promise<string>;
  /** Called once the transaction is confirmed on-chain. */
  onSuccess?: (result: ContractTxResult) => void;
  /** React Query keys to invalidate after a successful confirmation. */
  invalidateKeys?: readonly unknown[][];
  /** Network passphrase used to sign and submit. */
  networkPassphrase?: string;
  /** Soroban RPC endpoint used to submit and poll for confirmation. */
  rpcUrl?: string;
  /** How long to wait for confirmation before surfacing a timeout. */
  confirmTimeoutMs?: number;
}

const config = getConfig();
const DEFAULT_NETWORK_PASSPHRASE = config.network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const DEFAULT_RPC_URL = config.sorobanRpcUrl;
const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

/** Maps a Soroban contract error code to a human readable message. */
const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  1: 'The contract rejected this operation.',
  2: 'Insufficient balance to complete this transaction.',
  3: 'This action has already been completed.',
  4: 'The operation is not allowed in the current state.',
  5: 'The provided amount is invalid.',
};

function explorerUrlFor(hash: string): string {
  return stellarExpertUrl('tx', hash, config.network);
}

function classifyError(error: unknown): ContractTxError {
  const raw = error as { message?: string; response?: { data?: { extras?: { result_codes?: { transaction?: string }; result_xdr?: string } } }; resultXdr?: string; resultXdrBase64?: string; result_xdr?: string; code?: number };
  const message = raw?.message ?? String(error);
  const lower = message.toLowerCase();

  if (lower.includes('user declined') || lower.includes('rejected') || lower.includes('denied')) {
    return { kind: 'user-rejected', message: 'You rejected the signature request.', retryable: true };
  }

  if (lower.includes('insufficient') || lower.includes('underfunded') || lower.includes('op_underfunded')) {
    return { kind: 'insufficient-balance', message: 'Insufficient balance to complete this transaction.', retryable: false };
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { kind: 'timeout', message: 'The transaction timed out. It may still confirm — check the explorer.', retryable: true };
  }

  const xdrError = raw.resultXdrBase64 ?? raw.resultXdr ?? raw.result_xdr ?? raw.response?.data?.extras?.result_xdr ?? undefined;
  const txCode = raw.response?.data?.extras?.result_codes?.transaction;
  if (txCode) {
    return { kind: 'unknown', message: txCode.replace(/_/g, ' ').toLowerCase(), retryable: true, xdrError };
  }
  const code = typeof raw?.code === 'number' ? raw.code : undefined;
  if (code !== undefined || lower.includes('simulation')) {
    return {
      kind: 'simulation-failed',
      message: (code !== undefined && CONTRACT_ERROR_MESSAGES[code]) || 'The contract simulation failed.',
      code,
      retryable: false,
      xdrError,
    };
  }

  return { kind: 'unknown', message: message || 'Something went wrong.', retryable: true, xdrError };
}

/**
 * Reusable hook that drives the full on-chain transaction lifecycle:
 * build -> sign -> submit -> confirm. The tracking loop keeps running even if
 * the caller unmounts (e.g. the status dialog is closed), so a submitted
 * transaction is never lost.
 */
export function useContractTx({
  build,
  onSuccess,
  invalidateKeys,
  networkPassphrase = DEFAULT_NETWORK_PASSPHRASE,
  rpcUrl = DEFAULT_RPC_URL,
  confirmTimeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
}: UseContractTxOptions) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ContractTxState>('idle');
  const [error, setError] = useState<ContractTxError | null>(null);
  const [result, setResult] = useState<ContractTxResult | null>(null);

  // Keep the latest callbacks without re-creating `run` on every render.
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const invalidateKeysRef = useRef(invalidateKeys);
  invalidateKeysRef.current = invalidateKeys;

  // Tracks whether the component is still mounted so background completion
  // does not attempt to set state on an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetState = useCallback((next: ContractTxState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setResult(null);

    try {
      safeSetState('building');
      const xdr = await build();

      safeSetState('awaiting-signature');
      const signed = await signTransaction(xdr, { networkPassphrase });
      const signedXdr = typeof signed === 'string' ? signed : signed.signedTxXdr;

      safeSetState('submitting');
      const server = new SorobanRpc.Server(rpcUrl);
      const transaction = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      const submission = await server.sendTransaction(transaction);

      if (submission.status === 'ERROR') {
        throw Object.assign(new Error('Transaction submission failed'), {
          resultXdrBase64: submission.errorResult?.toXDR?.('base64') ?? undefined,
        });
      }

      const hash = submission.hash;
      safeSetState('confirming');

      const deadline = Date.now() + confirmTimeoutMs;
      let confirmed = false;
      while (Date.now() < deadline) {
        const status = await server.getTransaction(hash);
        if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          confirmed = true;
          break;
        }
        if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
          throw Object.assign(new Error('Transaction failed on-chain'), {
            resultXdrBase64: 'resultXdr' in status ? status.resultXdr : undefined,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (!confirmed) {
        throw new Error('Transaction confirmation timed out');
      }

      const txResult: ContractTxResult = { hash, explorerUrl: explorerUrlFor(hash) };
      if (mountedRef.current) setResult(txResult);
      safeSetState('success');

      if (invalidateKeysRef.current) {
        await Promise.all(
          invalidateKeysRef.current.map((key) => queryClient.invalidateQueries({ queryKey: key })),
        );
      }

      onSuccessRef.current?.(txResult);
      return txResult;
    } catch (err) {
      const classified = classifyError(err);
      if (mountedRef.current) setError(classified);
      safeSetState('error');
      return undefined;
    }
  }, [build, networkPassphrase, rpcUrl, confirmTimeoutMs, queryClient, safeSetState]);

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
    setResult(null);
  }, []);

  return {
    state,
    error,
    result,
    run,
    retry: run,
    reset,
    isPending: state !== 'idle' && state !== 'success' && state !== 'error',
  };
}

export default useContractTx;
