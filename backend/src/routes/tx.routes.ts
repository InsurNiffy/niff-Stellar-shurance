import { Router, Request, Response } from 'express';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { prisma } from '../lib/prisma';

const router = Router();

const TX_QUEUE_NAME = 'tx-submit';
const TX_QUEUE_MAX_DEPTH = Number(process.env.TX_QUEUE_MAX_DEPTH ?? 100);
const TX_MAX_RETRIES = Number(process.env.TX_MAX_RETRIES ?? 5);
const TX_CONFIRM_POLL_MS = Number(process.env.TX_CONFIRM_POLL_MS ?? 2000);
const TX_CONFIRM_TIMEOUT_MS = Number(process.env.TX_CONFIRM_TIMEOUT_MS ?? 60000);

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const rpc = new SorobanRpc.Server(
  process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
);

export const txSubmitQueue = new Queue(TX_QUEUE_NAME, { connection });

async function getQueueDepth(): Promise<number> {
  const counts = await txSubmitQueue.getJobCounts('waiting', 'active', 'delayed');
  return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
}

async function pollConfirmation(hash: string): Promise<{ status: string; ledger?: number }> {
  const deadline = Date.now() + TX_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await rpc.getTransaction(hash);
    if (res.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return { status: 'SUCCESS', ledger: res.ledger };
    }
    if (res.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      return { status: 'FAILED', ledger: res.ledger };
    }
    await new Promise((r) => setTimeout(r, TX_CONFIRM_POLL_MS));
  }
  return { status: 'TIMEOUT' };
}

async function processTxJob(job: Job<{ xdr: string; hash: string }>): Promise<void> {
  const { xdr, hash } = job.data;

  const sendRes = await rpc.sendTransaction(xdr);
  if (sendRes.status === 'ERROR') {
    throw new Error(`sendTransaction error: ${JSON.stringify(sendRes.errorResult ?? sendRes)}`);
  }

  const result = await pollConfirmation(hash);

  await prisma.transaction.update({
    where: { hash },
    data: {
      status: result.status,
      ledger: result.ledger ?? null,
      updatedAt: new Date(),
    },
  });
}

export const txSubmitWorker = new Worker(TX_QUEUE_NAME, processTxJob, {
  connection,
  attempts: TX_MAX_RETRIES,
  backoff: { type: 'exponential', delay: 1000 },
});

txSubmitWorker.on('failed', async (job, err) => {
  if (!job) return;
  const isFinal = job.attemptsMade >= TX_MAX_RETRIES;
  if (isFinal) {
    await prisma.transaction.update({
      where: { hash: job.data.hash },
      data: { status: 'FAILED', error: err.message, updatedAt: new Date() },
    });
  }
});

router.post('/submit', async (req: Request, res: Response) => {
  const { xdr, hash } = req.body ?? {};
  if (!xdr || !hash) {
    return res.status(400).json({ error: 'xdr and hash are required' });
  }

  const depth = await getQueueDepth();
  if (depth > TX_QUEUE_MAX_DEPTH) {
    return res.status(429).json({ error: 'Transaction queue is full, retry later' });
  }

  await prisma.transaction.upsert({
    where: { hash },
    create: { hash, status: 'PENDING', xdr },
    update: { status: 'PENDING', xdr, updatedAt: new Date() },
  });

  await txSubmitQueue.add('submit', { xdr, hash }, { jobId: hash });

  return res.status(202).json({ hash, status: 'PENDING' });
});

router.get('/status/:hash', async (req: Request, res: Response) => {
  const { hash } = req.params;
  const tx = await prisma.transaction.findUnique({ where: { hash } });
  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  return res.json({
    hash: tx.hash,
    status: tx.status,
    ledger: tx.ledger ?? null,
    error: tx.error ?? null,
  });
});

export default router;
