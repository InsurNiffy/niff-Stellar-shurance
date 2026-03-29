import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { rpc as SorobanRpc, scValToNative } from '@stellar/stellar-sdk';

type IndexerTx = Prisma.TransactionClient;
type SorobanEvent = SorobanRpc.Api.EventResponse;
type StellarNativeValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | StellarNativeValue[]
  | Record<string, unknown>;
type EventPayload = Record<string, unknown>;

const toInputJsonValue = (
  value: StellarNativeValue,
): Prisma.InputJsonValue | Prisma.JsonNullValueInput => {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }

  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === 'bigint') {
        return nestedValue.toString();
      }
      return nestedValue ?? null;
    }),
  ) as Prisma.InputJsonValue;
};

const getStringValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  if (value && typeof value === 'object' && 'toString' in value) {
    return String(value);
  }

  return '';
};

const getNumberValue = (value: unknown): number => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  return Number(getStringValue(value));
};

const getStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => getStringValue(entry));
};

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);
  private readonly BATCH_SIZE = 50;
  private readonly networkId: string;
  private readonly gapThresholdLedgers: number;
  private readonly gapCooldownMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
    private readonly config: ConfigService,
  ) {
    this.networkId = this.config.get<string>('STELLAR_NETWORK', 'testnet');
    this.gapThresholdLedgers = this.config.get<number>('INDEXER_GAP_ALERT_THRESHOLD_LEDGERS', 100);
    this.gapCooldownMs = this.config.get<number>('INDEXER_GAP_ALERT_COOLDOWN_MS', 3_600_000);
  }

  /** Bull reindex job: drain backlog for a network after cursor reset. */
  async processUntilCaughtUp(network?: string): Promise<{ batches: number; events: number }> {
    const net = network ?? this.networkId;
    let batches = 0;
    let events = 0;
    for (;;) {
      const r = await this.processNextBatchForNetwork(net);
      batches += 1;
      events += r.processed;
      if (r.processed === 0) {
        break;
      }
      if (batches > 10_000) {
        this.logger.warn(`processUntilCaughtUp stopped after ${batches} batches (safety cap)`);
        break;
      }
    }
    this.logger.log(`Reindex catch-up finished for ${net}: ${events} events in ${batches} batches`);
    return { batches, events };
  }

  async processNextBatch(): Promise<{ processed: number; lag: number }> {
    return this.processNextBatchForNetwork(this.networkId);
  }

  async processNextBatchForNetwork(network: string): Promise<{ processed: number; lag: number }> {
    const cursorRow = await this.ensureCursor(network);
    const lastProcessed = cursorRow.lastProcessedLedger;
    const latestLedger = await this.soroban.getLatestLedger();

    const gap = latestLedger - lastProcessed;
    if (gap > this.gapThresholdLedgers) {
      await this.maybeEmitGapAlert(network, gap, lastProcessed, latestLedger);
    }

    if (lastProcessed >= latestLedger) {
      return { processed: 0, lag: 0 };
    }

    const startLedger = lastProcessed + 1;
    this.logger.debug(`[${network}] Fetching events from ledger ${startLedger}`);

    const response = await this.soroban.getEvents(startLedger, this.BATCH_SIZE);
    const events = response.events || [];

    if (events.length === 0) {
      const newLast = Math.min(startLedger + 100, latestLedger);
      await this.prisma.$transaction(async (tx) => {
        await this.advanceCursorInTx(tx, network, newLast);
      });
      return { processed: 0, lag: latestLedger - newLast };
    }

    let processedCount = 0;
    for (let i = 0; i < events.length; i++) {
      await this.processEventForNetwork(network, events[i], i);
      processedCount++;
    }

    const maxLedger = Math.max(...events.map((e: SorobanEvent) => e.ledger));
    const lag = latestLedger - maxLedger;
    return { processed: processedCount, lag };
  }

  private async ensureCursor(network: string): Promise<{ lastProcessedLedger: number }> {
    let row = await this.prisma.ledgerCursor.findUnique({ where: { network } });
    if (row) {
      return row;
    }

    const legacy = await this.prisma.indexerState.findFirst({
      orderBy: { id: 'asc' },
    });
    const initial = legacy?.lastLedger ?? 0;
    row = await this.prisma.ledgerCursor.create({
      data: { network, lastProcessedLedger: initial },
    });
    this.logger.log(`Initialized ledger cursor for ${network} from legacy state: ${initial}`);
    return row;
  }

  /**
   * Advance cursor to at least `ledger` (monotonic). Caller must run inside a transaction
   * that also persists the events/projections for that ledger.
   */
  private async advanceCursorInTx(tx: IndexerTx, network: string, ledger: number): Promise<void> {
    const cur = await tx.ledgerCursor.findUnique({ where: { network } });
    const next = Math.max(cur?.lastProcessedLedger ?? 0, ledger);
    await tx.ledgerCursor.upsert({
      where: { network },
      create: { network, lastProcessedLedger: next },
      update: { lastProcessedLedger: next },
    });
  }

  private async maybeEmitGapAlert(
    network: string,
    gapSize: number,
    lastProcessedLedger: number,
    latestLedger: number,
  ): Promise<void> {
    const now = new Date();
    const dedup = await this.prisma.ledgerGapAlertDedup.findUnique({
      where: { network },
    });

    if (dedup) {
      const elapsed = now.getTime() - dedup.lastFiredAt.getTime();
      if (elapsed < this.gapCooldownMs) {
        return;
      }
    }

    this.logger.warn(
      JSON.stringify({
        alert: 'indexer_ledger_gap',
        network,
        gapLedgers: gapSize,
        lastProcessedLedger,
        latestLedger,
        threshold: this.gapThresholdLedgers,
      }),
    );

    await this.prisma.ledgerGapAlertDedup.upsert({
      where: { network },
      create: {
        network,
        lastFiredAt: now,
        lastGapSize: gapSize,
        lastProcessedLedger,
        latestLedger,
      },
      update: {
        lastFiredAt: now,
        lastGapSize: gapSize,
        lastProcessedLedger,
        latestLedger,
      },
    });
  }

  private async processEventForNetwork(network: string, event: SorobanEvent, index: number) {
    const txHash = event.txHash;

    const topics: StellarNativeValue[] = event.topic.map((topic) => {
      try {
        return scValToNative(topic) as StellarNativeValue;
      } catch {
        return topic.toXDR('base64');
      }
    });
    const dataNative = scValToNative(event.value) as EventPayload;
    const contractId = event.contractId?.toString() ?? '';

    await this.prisma.$transaction(async (tx) => {
      await tx.rawEvent.upsert({
        where: { txHash_eventIndex: { txHash, eventIndex: index } },
        create: {
          txHash,
          eventIndex: index,
          contractId,
          ledger: event.ledger,
          ledgerClosedAt: new Date(event.ledgerClosedAt),
          topic1: topics[0]?.toString(),
          topic2: topics[1]?.toString(),
          topic3: topics[2]?.toString(),
          topic4: topics[3]?.toString(),
          data: toInputJsonValue(dataNative as StellarNativeValue),
        },
        update: {},
      });

      const mainTopic = topics[0]?.toString();
      const subTopic = topics[1]?.toString();

      if (mainTopic === 'PolicyInitiated' || (mainTopic === 'policy' && subTopic === 'initiated')) {
        await this.handlePolicyInitiated(tx, dataNative, event);
      } else if (mainTopic === 'policy' && subTopic === 'renewed') {
        await this.handlePolicyRenewed(tx, dataNative);
      } else if (
        (mainTopic === 'claim' && subTopic === 'filed') ||
        (mainTopic === 'niffyinsure' && subTopic === 'claim_filed')
      ) {
        await this.handleClaimFiled(tx, dataNative, event);
      } else if (mainTopic === 'vote') {
        await this.handleVoteCast(tx, topics, dataNative as EventPayload, event);
      } else if (
        mainTopic === 'claim_pd' ||
        (mainTopic === 'niffyinsure' && subTopic === 'claim_paid')
      ) {
        await this.handleClaimProcessed(tx, dataNative, event);
      }

      await this.advanceCursorInTx(tx, network, event.ledger);
    });
  }

  private async handlePolicyInitiated(tx: IndexerTx, data: EventPayload, event: SorobanEvent) {
    const holder = getStringValue(data.holder);
    const policyId = getNumberValue(data.policy_id);
    const id = `${holder}:${policyId}`;

    await tx.policy.upsert({
      where: { id },
      create: {
        id,
        policyId,
        holderAddress: holder,
        policyType: getStringValue(data.policy_type),
        region: getStringValue(data.region),
        coverageAmount: getStringValue(data.coverage),
        premium: getStringValue(data.premium),
        isActive: true,
        startLedger: getNumberValue(data.start_ledger),
        endLedger: getNumberValue(data.end_ledger),
        txHash: event.txHash,
        eventIndex: 0,
      },
      update: {
        isActive: true,
        endLedger: getNumberValue(data.end_ledger),
        updatedAt: new Date(),
      },
    });
  }

  private async handlePolicyRenewed(tx: IndexerTx, data: EventPayload) {
    const id = `${getStringValue(data.holder)}:${getNumberValue(data.policy_id)}`;
    await tx.policy.update({
      where: { id },
      data: {
        endLedger: getNumberValue(data.new_end_ledger),
        updatedAt: new Date(),
      },
    });
  }

  private async handleClaimFiled(tx: IndexerTx, data: EventPayload, event: SorobanEvent) {
    const claimId = getNumberValue(data.claim_id);
    const policyDbId = `${getStringValue(data.claimant)}:${getNumberValue(data.policy_id)}`;

    await tx.claim.upsert({
      where: { id: claimId },
      create: {
        id: claimId,
        policyId: policyDbId,
        creatorAddress: getStringValue(data.claimant),
        amount: getStringValue(data.amount),
        asset: getStringValue(data.asset),
        description: getStringValue(data.details),
        imageUrls: getStringArray(data.image_urls),
        status: 'PENDING',
        approveVotes: 0,
        rejectVotes: 0,
        createdAtLedger: event.ledger,
        updatedAtLedger: event.ledger,
        txHash: event.txHash,
      },
      update: {
        amount: getStringValue(data.amount),
        description: getStringValue(data.details),
        imageUrls: getStringArray(data.image_urls),
      },
    });
  }

  private async handleVoteCast(
    tx: IndexerTx,
    topics: StellarNativeValue[],
    data: EventPayload,
    event: SorobanEvent,
  ) {
    const claimId = Number(topics[1]);
    const voter = topics[2]?.toString();
    const option = getStringValue(data.vote ?? data);

    if (!voter) {
      this.logger.warn(`Skipping vote event for claim ${claimId}: missing voter topic`);
      return;
    }

    await tx.vote.upsert({
      where: { claimId_voterAddress: { claimId, voterAddress: voter } },
      create: {
        claimId,
        voterAddress: voter,
        vote: option === 'Approve' ? 'APPROVE' : 'REJECT',
        votedAtLedger: event.ledger,
        txHash: event.txHash,
      },
      update: {
        vote: option === 'Approve' ? 'APPROVE' : 'REJECT',
      },
    });

    await tx.claim.update({
      where: { id: claimId },
      data: {
        approveVotes: getNumberValue(data.approve_votes),
        rejectVotes: getNumberValue(data.reject_votes),
      },
    });
  }

  private async handleClaimProcessed(tx: IndexerTx, data: EventPayload, event: SorobanEvent) {
    const claimId = getNumberValue(data.claim_id);
    await tx.claim.update({
      where: { id: claimId },
      data: {
        status: 'PAID',
        paidAt: new Date(event.ledgerClosedAt),
        updatedAtLedger: event.ledger,
      },
    });
  }
}
