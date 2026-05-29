/**
 * tx-submit worker — processes queued XDR submissions to the Soroban RPC.
 *
 * Lifecycle states written to Redis:
 *   queued     → set by the producer before enqueue
 *   processing → set at job start
 *   success    → set on successful RPC response
 *   failed     → set on exhausted retries or non-retryable error
 *
 * Idempotency: if the job carries an idempotency_key, the result is also
 * cached under tx:idem:<key> for 10 minutes (same as the sync path).
 *
 * Retry safety: Soroban sendTransaction is idempotent for the same signed XDR
 * (same hash). Re-submitting a tx that already landed returns its status.
 */

import { Worker, Job } from "bullmq";
import { getBullMQConnection } from "../redis/client";
import { RedisService } from "../cache/redis.service";
import { TxSubmitJobData, TX_SUBMIT_QUEUE } from "./tx.queue";
import { setTxState, TxState } from "./tx.state";
import {
  TransactionBuilder,
  FeeBumpTransaction,
  Transaction,
  xdr,
} from "@stellar/stellar-sdk";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";

const IDEMPOTENCY_TTL_SECONDS = 600;

function makeServer(rpcUrl: string): SorobanRpc.Server {
  return new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
}

function mapErrorCode(response: SorobanRpc.Api.SendTransactionResponse): string {
  if ("errorResultXdr" in response && response.errorResultXdr) {
    try {
      const result = xdr.TransactionResult.fromXDR(
        response.errorResultXdr as string,
        "base64",
      );
      const code = result.result().switch().name as string;
      const codeMap: Record<string, string> = {
        txBAD_SEQ: "TX_BAD_SEQ",
        txBAD_AUTH: "TX_BAD_AUTH",
        txINSUFFICIENT_FEE: "TX_INSUFFICIENT_FEE",
        txINSUFFICIENT_BALANCE: "TX_INSUFFICIENT_BALANCE",
        txNO_ACCOUNT: "TX_NO_ACCOUNT",
        txFAILED: "TX_FAILED",
        txTOO_EARLY: "TX_TOO_EARLY",
        txTOO_LATE: "TX_TOO_LATE",
        txINTERNAL_ERROR: "TX_INTERNAL_ERROR",
      };
      return codeMap[code] ?? `TX_ERROR_${code}`;
    } catch {
      // fall through
    }
  }
  return "TX_SUBMISSION_FAILED";
}

function errorCodeToMessage(code: string): string {
  const messages: Record<string, string> = {
    TX_BAD_SEQ: "Sequence number mismatch. Rebuild the transaction to fetch the latest sequence.",
    TX_BAD_AUTH: "One or more signatures are invalid or missing.",
    TX_INSUFFICIENT_FEE: "Fee is too low. Rebuild with a higher fee.",
    TX_INSUFFICIENT_BALANCE: "Source account has insufficient XLM balance.",
    TX_NO_ACCOUNT: "Source account does not exist on this network.",
    TX_FAILED: "Transaction failed. Check operation results for details.",
    TX_TOO_EARLY: "Transaction submitted before its minTime bound.",
    TX_TOO_LATE: "Transaction expired. Rebuild with a fresh timeout.",
    TX_INTERNAL_ERROR: "Stellar network internal error. Try again.",
    TX_SUBMISSION_FAILED: "Transaction submission failed.",
    RPC_UNAVAILABLE: "Could not reach the Soroban RPC endpoint. Try again shortly.",
  };
  return messages[code] ?? "An unknown submission error occurred.";
}

/**
 * Build the processor function. Accepts injected dependencies so the worker
 * can be started from the NestJS module with real services, or from tests
 * with mocks.
 */
export type ServerFactory = (rpcUrl: string) => { sendTransaction: (tx: Transaction) => Promise<SorobanRpc.Api.SendTransactionResponse> };

export function buildTxProcessor(
  redis: RedisService,
  rpcUrl: string,
  networkPassphrase: string,
  serverFactory: ServerFactory = makeServer,
) {
  return async function processTxJob(job: Job<TxSubmitJobData>): Promise<void> {
    const { signed_xdr, idempotency_key } = job.data;
    const jobId = job.id!;

    // Mark as processing
    await setTxState(redis, {
      jobId,
      status: "processing",
      updatedAt: new Date().toISOString(),
    });

    let parsed: Transaction | FeeBumpTransaction;
    try {
      parsed = TransactionBuilder.fromXDR(signed_xdr, networkPassphrase);
    } catch {
      const state: TxState = {
        jobId,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: {
          code: "INVALID_XDR",
          message: "Could not parse the signed_xdr. Ensure it is a valid base64-encoded TransactionEnvelope.",
        },
      };
      await setTxState(redis, state);
      // Do not throw — invalid XDR is not retryable
      return;
    }

    if (parsed instanceof FeeBumpTransaction) {
      await setTxState(redis, {
        jobId,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: {
          code: "FEE_BUMP_NOT_SUPPORTED",
          message: "Fee-bump envelopes are not accepted. Submit the inner transaction directly.",
        },
      });
      return;
    }

    const server = serverFactory(rpcUrl);
    let response: SorobanRpc.Api.SendTransactionResponse;
    try {
      response = await server.sendTransaction(parsed as Transaction);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Throw so BullMQ retries the job
      await setTxState(redis, {
        jobId,
        status: "processing", // still retrying
        updatedAt: new Date().toISOString(),
        error: { code: "RPC_UNAVAILABLE", message: msg },
      });
      throw new Error(`RPC_UNAVAILABLE: ${msg}`);
    }

    if (response.status === "ERROR") {
      const code = mapErrorCode(response);
      const state: TxState = {
        jobId,
        status: "failed",
        updatedAt: new Date().toISOString(),
        hash: response.hash,
        rpcStatus: response.status,
        error: { code, message: errorCodeToMessage(code) },
      };
      await setTxState(redis, state);

      if (idempotency_key) {
        await redis.set(`tx:idem:${idempotency_key}`, state, IDEMPOTENCY_TTL_SECONDS);
      }
      // Non-retryable RPC error — do not throw
      return;
    }

    const state: TxState = {
      jobId,
      status: "success",
      updatedAt: new Date().toISOString(),
      hash: response.hash,
      rpcStatus: response.status,
    };
    await setTxState(redis, state);

    if (idempotency_key) {
      await redis.set(`tx:idem:${idempotency_key}`, state, IDEMPOTENCY_TTL_SECONDS);
    }
  };
}

export type TxWorkerDeps = {
  redis: RedisService;
  rpcUrl: string;
  networkPassphrase: string;
};

export function startTxSubmitWorker(deps: TxWorkerDeps): Worker<TxSubmitJobData> {
  const processor = buildTxProcessor(deps.redis, deps.rpcUrl, deps.networkPassphrase);

  const worker = new Worker<TxSubmitJobData>(TX_SUBMIT_QUEUE, processor, {
    connection: getBullMQConnection(),
    concurrency: 5,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });

  worker.on("completed", (job: Job<TxSubmitJobData>) => {
    console.info(`[tx-submit worker] job ${job.id} completed`);
  });

  worker.on("failed", (job: Job<TxSubmitJobData> | undefined, err: Error) => {
    console.error(
      `[tx-submit worker] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );
  });

  worker.on("stalled", (jobId: string) => {
    console.warn(`[tx-submit worker] job ${jobId} stalled — will be requeued`);
  });

  worker.on("error", (err: Error) => {
    console.error("[tx-submit worker] worker error:", err.message);
  });

  return worker;
}
