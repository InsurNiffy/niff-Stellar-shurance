import { Injectable, Logger } from '@nestjs/common';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly soroban: SorobanService,
  ) {}

  async processNextBatch() {
    const state = await this.getState();
    const latestLedger = await this.soroban.getLatestLedger();

    if (state.lastLedger >= latestLedger) {
      return { processed: 0, lag: 0 };
    }

    const startLedger = state.lastLedger + 1;
    this.logger.debug(`Fetching events starting from ledger ${startLedger}`);

    const response = await this.soroban.getEvents(startLedger, this.BATCH_SIZE);
    const events = response.events || [];

    if (events.length === 0) {
      const newLastLedger = Math.min(startLedger + 100, latestLedger);
      await this.updateState(newLastLedger);
      return { processed: 0, lag: latestLedger - newLastLedger };
    }

    let processedCount = 0;
    for (let i = 0; i < events.length; i++) {
      await this.processEvent(events[i], i);
      processedCount++;
    }

    const maxLedger = Math.max(...events.map((e: any) => e.ledger));
    await this.updateState(maxLedger);

    return { processed: processedCount, lag: latestLedger - maxLedger };
  }

  private async getState() {
    let state = await this.prisma.indexerState.findFirst();
    if (!state) {
      state = await this.prisma.indexerState.create({ data: { lastLedger: 0 } });
    }
    return state;
  }

  private async updateState(lastLedger: number) {
    await this.prisma.indexerState.updateMany({
      data: { lastLedger, updatedAt: new Date() },
    });
  }

  private async processEvent(event: SorobanEvent, index: number) {
    const txHash = event.txHash;
    const eventIndex = index;

    // Idempotency check handled by unique constraint on rawEvent table
    const topics: StellarNativeValue[] = event.topic.map((topic) => {
      try {
        return scValToNative(topic) as StellarNativeValue;
      } catch {
        return topic.toXDR('base64');
      }
    });
    const dataNative = scValToNative(event.value) as EventPayload;
    const contractId = event.contractId?.toString() ?? '';

    const parsed = parseEvent(topics, dataNative, event.ledger, txHash);

    await this.prisma.$transaction(async (tx) => {
      // Idempotent raw-event store — unique constraint on (txHash, eventIndex).
      await tx.rawEvent.upsert({
        where: { txHash_eventIndex: { txHash, eventIndex: index } },
        create: {
          txHash,
          eventIndex,
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
      } else if (mainTopic === 'claim' && subTopic === 'filed') {
        await this.handleClaimFiled(tx, dataNative, event);
      } else if (mainTopic === 'vote') {
        await this.handleVoteCast(tx, topics, dataNative, event);
      } else if (mainTopic === 'claim_pd') {
        await this.handleClaimProcessed(tx, dataNative, event);
      }
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
      }
    });
  }

  private async handlePolicyRenewed(tx: IndexerTx, data: EventPayload) {
    const id = `${getStringValue(data.holder)}:${getNumberValue(data.policy_id)}`;
    await tx.policy.updateMany({
      where: { id, deletedAt: null },
      data: {
        endLedger: getNumberValue(data.new_end_ledger),
        updatedAt: new Date(),
      },
    });
  }

  private async handleClaimFiled(tx: IndexerTx, data: EventPayload, event: SorobanEvent) {
    const claimId = getNumberValue(data.claim_id);
    const holder = getStringValue(data.holder) || getStringValue(data.claimant);
    const policyIdNum = getNumberValue(data.policy_id);
    const policyDbId = `${holder}:${policyIdNum}`;

    await tx.claim.upsert({
      where: { id: claimId },
      create: {
        id: claimId,
        policyId: policyDbId,
        creatorAddress: getStringValue(data.claimant),
        amount: getStringValue(data.amount),
        asset: data.asset != null && data.asset !== '' ? getStringValue(data.asset) : null,
        description: getStringValue(data.details),
        imageUrls: getStringArray(data.image_urls),
        status: 'PENDING',
        approveVotes: 0,
        rejectVotes: 0,
        createdAtLedger: event.ledger,
        updatedAtLedger: event.ledger,
        txHash: event.txHash,
        eventIndex: 0,
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
    data: StellarNativeValue,
    event: SorobanEvent,
  ) {
    const claimId = Number(topics[1]);
    const voter = topics[2]?.toString();
    const payload =
      typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (data as EventPayload)
        : {};
    const option =
      payload.vote !== undefined && payload.vote !== null
        ? getStringValue(payload.vote)
        : getStringValue(data);

    if (!voter) {
      this.logger.warn(`Skipping vote event for claim ${claimId}: missing voter topic`);
      return;
    }

    if (option !== 'Approve' && option !== 'Reject') {
      this.logger.warn(`Skipping vote event for claim ${claimId}: unknown option "${option}"`);
      return;
    }

    const activeClaim = await tx.claim.findFirst({
      where: { id: claimId, deletedAt: null },
      select: { id: true },
    });
    if (!activeClaim) {
      this.logger.debug(`Skipping vote event for soft-deleted or missing claim ${claimId}`);
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
    await tx.claim.updateMany({
      where: { id: claimId, deletedAt: null },
      data: {
        approveVotes: getNumberValue(payload.approve_votes),
        rejectVotes: getNumberValue(payload.reject_votes),
        updatedAtLedger: event.ledger,
      },
    });
  }

  private async handleClaimProcessed(tx: IndexerTx, data: EventPayload, event: SorobanEvent) {
    const claimId = getNumberValue(data.claim_id);
    await tx.claim.updateMany({
      where: { id: claimId, deletedAt: null },
      data: {
        status: 'PAID',
        paidAt: new Date(event.ledgerClosedAt),
        updatedAtLedger: event.ledger,
      },
    });
  }
}
