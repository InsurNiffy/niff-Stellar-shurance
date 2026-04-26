"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getConfig } from "@/config/env";

type TxStatus = "PENDING" | "SUCCESS" | "FAILED" | "NOT_FOUND_TIMEOUT";
type HookStatus = "idle" | "pending" | TxStatus | null;

interface ApiResponse {
  status: TxStatus;
  error?: string;
  ledger?: number;
}

export interface TransactionStatusResult {
  status: HookStatus;
  error: string | null;
  explorerUrl: string | null;
}

export function useTransactionStatus(txHash: string | null): TransactionStatusResult {
  const [result, setResult] = useState<TransactionStatusResult>({
    status: null,
    error: null,
    explorerUrl: null,
  });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { apiUrl, explorerBase } = getConfig();

  const tick = useCallback(async (delay: number) => {
    if (!txHash) return;

    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${apiUrl}/tx/status/${txHash}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        const data: ApiResponse = await res.json();

        setResult((prev) => {
          if (data.status === "SUCCESS" || data.status === "FAILED" || data.status === "NOT_FOUND_TIMEOUT") {
            // Terminal state: compute explorerUrl
            const url = data.status !== "NOT_FOUND_TIMEOUT" ? `${explorerBase}/${txHash}` : null;
            return { status: data.status, error: data.error ?? null, explorerUrl: url };
          }
          // PENDING: continue polling
          return { ...prev, status: "pending", error: null };
        });

        // Continue polling if PENDING
        if (data.status === "PENDING") {
          const nextDelay = Math.min(delay * 2, 30000);
          tick(nextDelay);
        }
      } catch (err) {
        setResult((prev) => ({ ...prev, error: (err as Error).message }));
        // Retry on error with next delay
        const nextDelay = Math.min(delay * 2, 30000);
        tick(nextDelay);
      }
    }, delay);
  }, [txHash, apiUrl, explorerBase]);

  useEffect(() => {
    if (txHash) {
      setResult({ status: "pending", error: null, explorerUrl: null });
      tick(1000); // Start with 1s
    } else {
      setResult({ status: "idle", error: null, explorerUrl: null });
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [txHash, tick]);

  return result;
}

