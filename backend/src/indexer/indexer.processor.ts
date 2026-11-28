import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanRpcService } from '../soroban/soroban-rpc.service';
import { ConfigService } from '@nestjs/config';

const INDEXER_QUEUE = 'indexer';
const INDEXER_JOB = 'poll-events';
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 100;
const DEFAULT_LAG_ALERT_THRESHOLD = 100;

export interface SorobanEventRecord {
  txHash: string;
  eventIndex: number;
  ledger: number;
  contractId: string;
  topic: string[];
  value: unknown;
}

@Injectable()
@Processor(INDEXER_QUEUE)
export class IndexerProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(IndexerProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanRpcService,
    private readonly config: ConfigService,
    @InjectQueue(INDEXER_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      INDEXER_JOB,
      {},
      {
        repeat: { every: this.getPollIntervalMs() },
        removeOnComplete: true,
        removeOnFail: false,
        jobId: INDEXER_JOB,
      },
    );
  }

  async process(_job: Job): Promise<void> {
    await this.pollOnce();
  }

  async pollOnce(): Promise<void> {
    const contractId = this.config.get<string>('SOROBAN_CONTRACT_ID');
    if (!contractId) {
      this.logger.warn('SOROBAN_CONTRACT_ID not configured; skipping indexer poll');
      return;
    }

    const batchSize = this.getBatchSize();
    const cursor = await this.prisma.ledgerCursor.findUnique({
      where: { contractId },
    });
    const startLedger = cursor?.lastProcessedLedger ?? 0;

    const latestLedger = await this.soroban.getLatestLedger();
    const lag = latestLedger - startLedger;
    const threshold = this.getLagAlertThreshold();
    if (lag > threshold) {
      this.logger.error(
        `Indexer lag detected: current_ledger=${latestLedger} last_processed=${startLedger} lag=${lag} threshold=${threshold}`,
      );
    }

    const events = await this.soroban.getEvents({
      contractId,
      startLedger: startLedger + 1,
      limit: batchSize,
    });

    if (events.length === 0) {
      return;
    }

    const maxLedger = events.reduce(
      (max, e) => (e.ledger > max ? e.ledger : max),
      startLedger,
    );

    await this.prisma.$transaction(async (tx) => {
      for (const event of events) {
        await tx.rawEvent.upsert({
          where: {
            txHash_eventIndex: {
              txHash: event.txHash,
              eventIndex: event.eventIndex,
            },
          },
          create: {
            txHash: event.txHash,
            eventIndex: event.eventIndex,
            ledger: event.ledger,
            contractId: event.contractId,
            topic: event.topic,
            value: event.value as any,
          },
          update: {},
        });
      }

      await tx.ledgerCursor.upsert({
        where: { contractId },
        create: { contractId, lastProcessedLedger: maxLedger },
        update: { lastProcessedLedger: maxLedger },
      });
    });

    this.logger.log(
      `Indexed ${events.length} event(s); cursor advanced to ledger ${maxLedger}`,
    );
  }

  private getBatchSize(): number {
    const raw = Number(this.config.get<string>('INDEXER_BATCH_SIZE'));
    if (!Number.isFinite(raw) || raw <= 0) {
      return DEFAULT_BATCH_SIZE;
    }
    return Math.min(Math.floor(raw), MAX_BATCH_SIZE);
  }

  private getLagAlertThreshold(): number {
    const raw = Number(
      this.config.get<string>('INDEXER_LAG_ALERT_THRESHOLD'),
    );
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LAG_ALERT_THRESHOLD;
  }

  private getPollIntervalMs(): number {
    const raw = Number(this.config.get<string>('INDEXER_POLL_INTERVAL_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
  }
}
