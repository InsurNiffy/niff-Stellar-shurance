import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Queue, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { getBullMQConnection } from '../redis/client';
import { TX_SUBMIT_QUEUE } from '../queues/names';
import { getQueueConcurrency } from '../queues/queue-config';
import { TxSubmitJobData } from './tx-submit.queue';
import { rpc as SorobanRpc, TransactionBuilder } from '@stellar/stellar-sdk';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class TxSubmitWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TxSubmitWorker.name);
  private worker!: Worker<TxSubmitJobData>;
  private statsQueue!: Queue<TxSubmitJobData>;
  private metricsInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    const concurrencyMap = this.config.get<string>('QUEUE_CONCURRENCY_MAP', '');
    const concurrency = getQueueConcurrency('tx-submit', concurrencyMap);

    this.worker = new Worker<TxSubmitJobData>(
      TX_SUBMIT_QUEUE,
      async (job: Job<TxSubmitJobData>) => this.process(job),
      { connection: getBullMQConnection(), concurrency },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error(`TX job ${job?.id} failed: ${err.message}`),
    );

    this.statsQueue = new Queue<TxSubmitJobData>(TX_SUBMIT_QUEUE, {
      connection: getBullMQConnection(),
    });

    this.metricsInterval = setInterval(() => this.emitQueueMetrics(), 10_000);
    this.emitQueueMetrics();
  }

  async onModuleDestroy() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    await this.worker.close();
    await this.statsQueue.close();
  }

  private async emitQueueMetrics(): Promise<void> {
    try {
      const counts = await this.statsQueue.getJobCounts();
      const active = counts.active ?? 0;
      this.metrics.recordQueueActiveWorkers({ queue: TX_SUBMIT_QUEUE, count: active });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to emit queue metrics for ${TX_SUBMIT_QUEUE}: ${msg}`);
    }
  }

  private async process(job: Job<TxSubmitJobData>) {
    const { signed_xdr, idempotency_key } = job.data;

    if (idempotency_key && job.id !== `idem:${idempotency_key}`) {
      this.logger.warn(`Idempotency key mismatch for job ${job.id}: expected idem:${idempotency_key}`);
    }

    const rpcUrl = this.config.get<string>('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org');
    const passphrase = this.config.get<string>('STELLAR_NETWORK_PASSPHRASE', 'Test SDF Network ; September 2015');

    const server = new SorobanRpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });

    let parsed: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      parsed = TransactionBuilder.fromXDR(signed_xdr, passphrase);
    } catch {
      throw new Error('INVALID_XDR: Could not parse signed_xdr');
    }

    const response = await server.sendTransaction(parsed);

    if (response.status === 'ERROR') {
      throw new Error(`TX_SUBMISSION_FAILED: Transaction submission failed`);
    }

    this.logger.log(`TX submitted hash=${response.hash} status=${response.status}`);
    return {
      hash: response.hash,
      status: response.status,
      ledger: (response as { ledger?: number }).ledger,
    };
  }
}
