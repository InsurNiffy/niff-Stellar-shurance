import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export const TX_SUBMIT_QUEUE = 'tx-submit';
export const TX_SUBMIT_DLQ = 'tx-submit-dlq';

const MAX_ATTEMPTS = Number(process.env.TX_QUEUE_MAX_ATTEMPTS ?? 5);
const POLL_INTERVAL_MS = Number(process.env.TX_POLL_INTERVAL_MS ?? 2000);
const POLL_TIMEOUT_MS = Number(process.env.TX_POLL_TIMEOUT_MS ?? 60000);

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const rpc = new SorobanRpc.Server(process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org');

export const txSubmitQueue = new Queue(TX_SUBMIT_QUEUE, { connection });
export const txSubmitDlq = new Queue(TX_SUBMIT_DLQ, { connection });

export interface TxSubmitJobData {
  txHash: string;
  signedXdr: string;
}

function isTransientRpcError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|503|502|504|rate limit/i.test(message);
}

async function pollForConfirmation(txHash: string): Promise<SorobanRpc.Api.GetTransactionResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await rpc.getTransaction(txHash);
    if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for confirmation of ${txHash}`);
}

async function processTxSubmit(job: Job<TxSubmitJobData>): Promise<void> {
  const { txHash, signedXdr } = job.data;

  try {
    const sendResult = await rpc.sendTransaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import('@stellar/stellar-sdk')).TransactionBuilder.fromXDR(signedXdr, process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015') as any,
    );

    if (sendResult.status === 'ERROR') {
      throw new Error(`sendTransaction failed: ${JSON.stringify(sendResult.errorResult ?? sendResult)}`);
    }

    const confirmation = await pollForConfirmation(txHash);

    if (confirmation.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      await prisma.transaction.update({
        where: { hash: txHash },
        data: { status: 'SUCCESS', ledger: confirmation.ledger ?? null },
      });
      logger.info({ txHash }, 'tx-submit: transaction confirmed');
    } else {
      await prisma.transaction.update({
        where: { hash: txHash },
        data: { status: 'FAILED' },
      });
      logger.warn({ txHash, status: confirmation.status }, 'tx-submit: transaction failed on-chain');
    }
  } catch (err) {
    if (isTransientRpcError(err) && job.attemptsMade + 1 < MAX_ATTEMPTS) {
      logger.warn({ txHash, attempt: job.attemptsMade + 1, err }, 'tx-submit: transient RPC error, retrying');
      throw err;
    }

    await prisma.transaction.update({
      where: { hash: txHash },
      data: { status: 'FAILED' },
    });
    await txSubmitDlq.add('dead-letter', { ...job.data, error: err instanceof Error ? err.message : String(err) });
    logger.error({ txHash, err }, 'tx-submit: moved to DLQ');
  }
}

export const txSubmitWorker = new Worker<TxSubmitJobData>(TX_SUBMIT_QUEUE, processTxSubmit, {
  connection,
  concurrency: Number(process.env.TX_QUEUE_CONCURRENCY ?? 5),
});

txSubmitWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'tx-submit: job failed');
});

txSubmitWorker.on('error', (err) => {
  logger.error({ err }, 'tx-submit: worker error');
});
