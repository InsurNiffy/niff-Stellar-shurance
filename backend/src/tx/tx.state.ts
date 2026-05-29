/**
 * Tx state store — persists job lifecycle state in Redis.
 *
 * Key schema: tx:state:<jobId>
 * TTL: 24 hours (jobs are ephemeral; clients should poll within this window)
 */

import { RedisService } from "../cache/redis.service";

export type TxStatus = "queued" | "processing" | "success" | "failed";

export interface TxState {
  jobId: string;
  status: TxStatus;
  /** ISO timestamp of last state change */
  updatedAt: string;
  /** Soroban transaction hash (available after submission) */
  hash?: string;
  /** Soroban RPC status string (PENDING, SUCCESS, ERROR, etc.) */
  rpcStatus?: string;
  /** Ledger the tx was included in */
  ledger?: number;
  /** Structured error for failed jobs */
  error?: {
    code: string;
    message: string;
  };
}

const STATE_TTL_SECONDS = 86_400; // 24 h

export function txStateKey(jobId: string): string {
  return `tx:state:${jobId}`;
}

export async function setTxState(
  redis: RedisService,
  state: TxState,
): Promise<void> {
  await redis.set(txStateKey(state.jobId), state, STATE_TTL_SECONDS);
}

export async function getTxState(
  redis: RedisService,
  jobId: string,
): Promise<TxState | null> {
  return redis.get<TxState>(txStateKey(jobId));
}
