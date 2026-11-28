import { useCallback, useEffect, useRef, useState } from "react";

export type TransactionStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "NOT_FOUND_TIMEOUT";

const TERMINAL_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  "SUCCESS",
  "FAILED",
  "NOT_FOUND_TIMEOUT",
]);

const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

const EXPLORER_BASE_URLS: Record<string, string> = {
  testnet: "https://stellar.expert/explorer/testnet/tx",
  mainnet: "https://stellar.expert/explorer/public/tx",
};

function getExplorerBaseUrl(): string {
  const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet").toLowerCase();
  return EXPLORER_BASE_URLS[network] ?? EXPLORER_BASE_URLS.testnet;
}

export interface UseTransactionStatusResult {
  status: TransactionStatus | null;
  error: string | null;
  explorerUrl: string | null;
}

async function fetchTransactionStatus(hash: string): Promise<TransactionStatus> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  const response = await fetch(`${baseUrl}/tx/status/${hash}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch transaction status (${response.status})`);
  }
  const data = (await response.json()) as { status?: string };
  const status = (data.status ?? "PENDING").toUpperCase() as TransactionStatus;
  return status;
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

    setStatus("PENDING");
    setError(null);
    setExplorerUrl(null);

    let delay = INITIAL_DELAY_MS;

    const poll = async () => {
      if (cancelledRef.current) return;

      try {
        const nextStatus = await fetchTransactionStatus(txHash);
        if (cancelledRef.current) return;

        setStatus(nextStatus);

        if (TERMINAL_STATUSES.has(nextStatus)) {
          setExplorerUrl(`${getExplorerBaseUrl()}/${txHash}`);
          return;
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      }

      if (cancelledRef.current) return;
      timeoutRef.current = setTimeout(poll, delay);
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
