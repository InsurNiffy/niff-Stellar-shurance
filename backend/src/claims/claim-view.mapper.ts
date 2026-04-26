import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { SanitizationService } from './sanitization.service';
import {
  ClaimDetailResponseDto,
  ClaimMetadataDto,
  ConsistencyMetadataDto,
  DeadlineDto,
  QuorumProgressDto,
  SanitizedEvidenceDto,
  VoteTalliesDto,
} from './dto/claim.dto';

const VOTE_WINDOW_LEDGERS = 120_960;
const SECONDS_PER_LEDGER = 5;

export type ClaimWithVotes = Prisma.ClaimGetPayload<{
  include: {
    votes: { select: { vote: true } };
  };
}>;

@Injectable()
export class ClaimViewMapper {
  private readonly ipfsGateway: string;
  private readonly maxAcceptableLag = 5;

  constructor(
    private readonly sanitization: SanitizationService,
    config: ConfigService,
  ) {
    this.ipfsGateway = config.get<string>('IPFS_GATEWAY', 'https://ipfs.io');
  }

  transformClaim(
    claim: ClaimWithVotes,
    lastLedger: number,
    aggregation?: {
      quorum_progress_pct: number;
      votes_needed: number;
      deadline_estimate_utc: string;
    },
  ): ClaimDetailResponseDto {
    const yesVotes = claim.votes.filter((vote) => vote.vote === 'APPROVE').length;
    const noVotes = claim.votes.filter((vote) => vote.vote === 'REJECT').length;
    const totalVotes = yesVotes + noVotes;
    const votingDeadlineLedger = this.getVotingDeadlineLedger(claim.createdAtLedger);
    const votingDeadlineTime = new Date(
      claim.createdAt.getTime() + VOTE_WINDOW_LEDGERS * SECONDS_PER_LEDGER * 1000,
    );
    const isOpen = votingDeadlineLedger > lastLedger;
    const remainingSeconds = isOpen
      ? (votingDeadlineLedger - lastLedger) * SECONDS_PER_LEDGER
      : undefined;
    const requiredVotes = Math.max(1, Math.floor(totalVotes / 2) + 1);
    const sanitizedHash = this.sanitization.sanitizeIpfsHash(
      this.extractEvidenceHash(claim.imageUrls),
    );
    const indexerLag = Math.max(0, lastLedger - claim.updatedAtLedger);
    const quorumProgressPct =
      aggregation?.quorum_progress_pct ?? Math.min(100, Math.round((totalVotes / requiredVotes) * 100));
    const votesNeeded = aggregation?.votes_needed ?? Math.max(0, requiredVotes - totalVotes);
    const deadlineEstimateUtc = aggregation?.deadline_estimate_utc ?? votingDeadlineTime.toISOString();
    const currentStatus = claim.status.toLowerCase() as 'pending' | 'approved' | 'paid' | 'rejected';
    const statusHistory: ClaimDetailResponseDto['status_history'] = [
      {
        status: 'pending' as const,
        ledger: claim.createdAtLedger,
        timestamp: claim.createdAt.toISOString(),
      },
    ];

    if (currentStatus !== 'pending') {
      statusHistory.push({
        status: currentStatus,
        ledger: claim.updatedAtLedger || claim.createdAtLedger,
        timestamp: claim.updatedAt.toISOString(),
      });
    }

    return {
      metadata: {
        id: claim.id,
        policyId: claim.policyId,
        creatorAddress: this.sanitization.sanitizeWalletAddress(claim.creatorAddress),
        status: currentStatus,
        amount: claim.amount,
        description: claim.description
          ? this.sanitization.sanitizeDescription(claim.description)
          : undefined,
        evidenceHash: sanitizedHash,
        createdAtLedger: claim.createdAtLedger,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
      } as ClaimMetadataDto,
      votes: {
        yesVotes,
        noVotes,
        totalVotes,
      } as VoteTalliesDto,
      quorum: {
        required: requiredVotes,
        current: totalVotes,
        percentage: Math.min(100, Math.round((totalVotes / requiredVotes) * 100)),
        reached: claim.isFinalized || Math.max(yesVotes, noVotes) >= requiredVotes,
        quorum_progress_pct: quorumProgressPct,
        votes_needed: votesNeeded,
      } as QuorumProgressDto,
      deadline: {
        votingDeadlineLedger,
        votingDeadlineTime,
        isOpen,
        remainingSeconds,
        deadline_estimate_utc: deadlineEstimateUtc,
      } as DeadlineDto,
      evidence: {
        gatewayUrl: sanitizedHash ? `${this.ipfsGateway}/ipfs/${sanitizedHash}` : '',
        hash: sanitizedHash,
      } as SanitizedEvidenceDto,
      consistency: {
        isFinalized: claim.isFinalized,
        indexerLag,
        lastIndexedLedger: lastLedger,
        isStale: indexerLag > this.maxAcceptableLag,
        tallyReconciled: true,
      } as ConsistencyMetadataDto,
      quorum_progress_pct: quorumProgressPct,
      votes_needed: votesNeeded,
      deadline_estimate_utc: deadlineEstimateUtc,
      status_history: statusHistory,
      voter_eligible: false,
    };
  }

  getVotingDeadlineLedger(createdAtLedger: number): number {
    return createdAtLedger + VOTE_WINDOW_LEDGERS;
  }

  private extractEvidenceHash(imageUrls: string[]): string {
    for (const imageUrl of imageUrls) {
      const directHash = this.sanitization.sanitizeIpfsHash(imageUrl);
      if (directHash) {
        return directHash;
      }

      const match = imageUrl.match(/\/ipfs\/([^/?#]+)/i);
      if (match?.[1]) {
        return match[1];
      }
    }

    return '';
  }
}
