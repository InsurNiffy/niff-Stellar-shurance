import { useCallback, useEffect, useRef, useState } from 'react';

export type TransactionStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'NOT_FOUND_TIMEOUT';

const TERMINAL_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  'SUCCESS',
  'FAILED',
  'NOT_FOUND_TIMEOUT',
]);

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

const EXPLORER_BASE_URLS: Record<string, string> = {
  mainnet: 'https://stellar.expert/explorer/public/tx',
  testnet: 'https://stellar.expert/explorer/testnet/tx',
  futurenet: 'https://stellar.expert/explorer/futurenet/tx',
};

function getExplorerUrl(txHash: string): string {
  const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet').toLowerCase();
  const base = EXPLORER_BASE_URLS[network] ?? EXPLORER_BASE_URLS.testnet;
  return `${base}/${txHash}`;
}

function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || '';
}

export interface UseTransactionStatusResult {
  status: TransactionStatus | null;
  error: string | null;
  explorerUrl: string | null;
}

export function useTransactionStatus(
  txHash: string | null,
): UseTransactionStatusResult {
  const [status, setStatus] = useState<TransactionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    clearTimer();

    if (!txHash) {
      setStatus(null);
      setError(null);
      setExplorerUrl(null);
      return;
    }

    setStatus('PENDING');
    setError(null);
    setExplorerUrl(null);

    let delay = INITIAL_DELAY_MS;

    const poll = async () => {
      if (cancelledRef.current) return;

      try {
        const res = await fetch(
          `${getApiBaseUrl()}/tx/status/${encodeURIComponent(txHash)}`,
        );

        if (cancelledRef.current) return;

        if (!res.ok) {
          throw new Error(`Request failed with status ${res.status}`);
        }

        const data = (await res.json()) as { status?: TransactionStatus };
        const nextStatus = data.status ?? 'PENDING';

        if (cancelledRef.current) return;

        setStatus(nextStatus);

        if (TERMINAL_STATUSES.has(nextStatus)) {
          setExplorerUrl(getExplorerUrl(txHash));
          return;
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
      }

      if (cancelledRef.current) return;

      timeoutRef.current = setTimeout(() => {
        void poll();
      }, delay);
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    };

    void poll();

    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [txHash, clearTimer]);

  return { status, error, explorerUrl };
}
