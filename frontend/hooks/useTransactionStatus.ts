import { useCallback, useEffect, useRef, useState } from 'react';

export type TransactionStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'NOT_FOUND_TIMEOUT';

const TERMINAL_STATES: ReadonlySet<TransactionStatus> = new Set([
  'SUCCESS',
  'FAILED',
  'NOT_FOUND_TIMEOUT',
]);

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const MAX_ATTEMPTS = 12;

const EXPLORER_BASE_URLS: Record<string, string> = {
  mainnet: 'https://stellar.expert/explorer/public/tx',
  testnet: 'https://stellar.expert/explorer/testnet/tx',
  futurenet: 'https://stellar.expert/explorer/futurenet/tx',
};

function getExplorerBaseUrl(): string {
  const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet').toLowerCase();
  return EXPLORER_BASE_URLS[network] ?? EXPLORER_BASE_URLS.testnet;
}

function buildExplorerUrl(txHash: string | null): string | null {
  if (!txHash) return null;
  return `${getExplorerBaseUrl()}/${txHash}`;
}

function nextDelay(attempt: number): number {
  return Math.min(INITIAL_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
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
      return;
    }

    setStatus('PENDING');
    setError(null);

    let attempt = 0;

    const poll = async () => {
      if (cancelledRef.current) return;

      try {
        const response = await fetch(`/tx/status/${txHash}`);
        if (cancelledRef.current) return;

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = (await response.json()) as { status?: TransactionStatus };
        if (cancelledRef.current) return;

        const nextStatus = data.status ?? 'PENDING';
        setStatus(nextStatus);

        if (TERMINAL_STATES.has(nextStatus)) {
          return;
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch transaction status');
      }

      attempt += 1;
      if (attempt >= MAX_ATTEMPTS) {
        setStatus('NOT_FOUND_TIMEOUT');
        return;
      }

      timeoutRef.current = setTimeout(poll, nextDelay(attempt - 1));
    };

    void poll();

    return () => {
      cancelledRef.current = true;
      clearTimer();
    };
  }, [txHash, clearTimer]);

  const explorerUrl =
    status && TERMINAL_STATES.has(status) ? buildExplorerUrl(txHash) : null;

  return { status, error, explorerUrl };
}
