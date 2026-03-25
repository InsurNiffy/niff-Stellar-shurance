import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { scValToNative, xdr } from '@stellar/stellar-sdk';

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

    const maxLedger = Math.max(...events.map(e => e.ledger));
    await this.updateState(maxLedger);

    return { 
      processed: processedCount, 
      lag: latestLedger - maxLedger 
    };
  }

  private async getState() {
    let state = await this.prisma.indexerState.findFirst();
    if (!state) {
      state = await this.prisma.indexerState.create({
        data: { lastLedger: 0 },
      });
    }
    return state;
  }

  private async updateState(lastLedger: number) {
    await this.prisma.indexerState.updateMany({
      data: { lastLedger, updatedAt: new Date() },
    });
  }

  private async processEvent(event: any, index: number) {
    const txHash = event.txHash;
    const eventIndex = index;

    // Idempotency check handled by unique constraint on rawEvent table
    const topics = event.topic.map((t: string) => {
        try {
            return scValToNative(xdr.ScVal.fromXDR(t, 'base64'));
        } catch (e) {
            return t;
        }
    });

    const dataNative = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));

    await this.prisma.$transaction(async (tx) => {
      // Save raw event
      await tx.rawEvent.upsert({
        where: { txHash_eventIndex: { txHash, eventIndex } },
        create: {
          txHash,
          eventIndex,
          contractId: event.contractId,
          ledger: event.ledger,
          ledgerClosedAt: new Date(event.ledgerClosedAt),
          topic1: topics[0]?.toString(),
          topic2: topics[1]?.toString(),
          topic3: topics[2]?.toString(),
          topic4: topics[3]?.toString(),
          data: dataNative,
        },
        update: {},
      });

      const mainTopic = topics[0]?.toString();
      const subTopic = topics[1]?.toString();

      if (mainTopic === 'PolicyInitiated' || (mainTopic === 'policy' && subTopic === 'initiated')) {
          await this.handlePolicyInitiated(tx, dataNative, event);
      } else if (mainTopic === 'policy' && subTopic === 'renewed') {
          await this.handlePolicyRenewed(tx, dataNative, event);
      } else if (mainTopic === 'claim' && subTopic === 'filed') {
          await this.handleClaimFiled(tx, dataNative, event);
      } else if (mainTopic === 'vote') {
          await this.handleVoteCast(tx, topics, dataNative, event);
      } else if (mainTopic === 'claim_pd') {
          await this.handleClaimProcessed(tx, dataNative, event);
      }
    });
  }

  private async handlePolicyInitiated(tx: any, data: any, event: any) {
    const id = `${data.holder}:${data.policy_id}`;
    await tx.policy.upsert({
        where: { id },
        create: {
            id,
            policyId: Number(data.policy_id),
            holderAddress: data.holder,
            policyType: data.policy_type,
            region: data.region,
            coverageAmount: data.coverage.toString(),
            premium: data.premium.toString(),
            isActive: true,
            startLedger: data.start_ledger,
            endLedger: data.end_ledger,
            txHash: event.txHash,
            eventIndex: 0,
        },
        update: {
            isActive: true,
            endLedger: data.end_ledger,
            updatedAt: new Date(),
        }
    });
  }

  private async handlePolicyRenewed(tx: any, data: any, event: any) {
    const id = `${data.holder}:${data.policy_id}`;
    await tx.policy.update({
        where: { id },
        data: {
            endLedger: data.new_end_ledger,
            updatedAt: new Date(),
        }
    });
  }

  private async handleClaimFiled(tx: any, data: any, event: any) {
    const claimId = Number(data.claim_id);
    const id = `${data.claimant}:${data.policy_id}`;

    await tx.claim.upsert({
        where: { id: claimId },
        create: {
            id: claimId,
            policyId: id,
            creatorAddress: data.claimant,
            amount: data.amount.toString(),
            asset: data.asset,
            description: data.details,
            imageUrls: data.image_urls,
            status: 'PENDING',
            approveVotes: 0,
            rejectVotes: 0,
            createdAtLedger: event.ledger,
            txHash: event.txHash,
        },
        update: {
            // Already exists from previous vote or processing (shouldn't happen with correct order but handle it)
            amount: data.amount.toString(),
            description: data.details,
            imageUrls: data.image_urls,
        }
    });
  }

  private async handleVoteCast(tx: any, topics: any[], data: any, event: any) {
    const claimId = Number(topics[1]);
    const voter = topics[2]?.toString();
    const option = data; // VoteOption enum: "Approve" or "Reject"

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
        }
    });

    // We can also trigger a background task to recalculate total votes if needed
  }

  private async handleClaimProcessed(tx: any, data: any, event: any) {
    const claimId = Number(data.claim_id);
    await tx.claim.update({
        where: { id: claimId },
        data: {
            status: 'PAID',
            paidAt: new Date(event.ledgerClosedAt),
            updatedAtLedger: event.ledger,
        }
    });
  }
}
