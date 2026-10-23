import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ClaimAggregation } from './entities/claim-aggregation.entity';
import { Claim } from './entities/claim.entity';
import { Vote } from './entities/vote.entity';

export const CLAIM_AGGREGATION_QUEUE = 'claim-aggregation';
export const CLAIM_AGGREGATION_JOB = 'recompute-claim-aggregation';

const DEFAULT_QUORUM = 100;
const DEFAULT_VOTING_WINDOW_LEDGERS = 120960;

@Injectable()
@Processor(CLAIM_AGGREGATION_QUEUE)
export class ClaimAggregationService extends WorkerHost {
  private readonly logger = new Logger(ClaimAggregationService.name);

  constructor(
    @InjectRepository(ClaimAggregation)
    private readonly aggregationRepo: Repository<ClaimAggregation>,
    @InjectRepository(Claim)
    private readonly claimRepo: Repository<Claim>,
    @InjectRepository(Vote)
    private readonly voteRepo: Repository<Vote>,
    @InjectQueue(CLAIM_AGGREGATION_QUEUE)
    private readonly aggregationQueue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.aggregationQueue.add(
      CLAIM_AGGREGATION_JOB,
      {},
      {
        repeat: { every: 60_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name !== CLAIM_AGGREGATION_JOB) {
      return;
    }
    await this.recomputeAll();
  }

  async recomputeAll(): Promise<void> {
    const claims = await this.claimRepo.find();
    for (const claim of claims) {
      try {
        await this.recomputeForClaim(claim.id);
      } catch (err) {
        this.logger.error(
          `Failed to aggregate claim ${claim.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  async recomputeForClaim(claimId: string): Promise<ClaimAggregation> {
    const claim = await this.claimRepo.findOne({ where: { id: claimId } });
    if (!claim) {
      throw new Error(`Claim ${claimId} not found`);
    }

    const votes = await this.voteRepo.find({ where: { claimId } });
    const votesCast = votes.length;
    const approvals = votes.filter((v) => v.approve).length;
    const rejections = votesCast - approvals;

    const quorum = claim.quorum ?? DEFAULT_QUORUM;
    const quorumPercentage = quorum > 0 ? (votesCast / quorum) * 100 : 0;

    const currentLedger = claim.currentLedger ?? 0;
    const deadlineLedger =
      claim.deadlineLedger ??
      (claim.createdLedger ?? 0) + DEFAULT_VOTING_WINDOW_LEDGERS;
    const ledgersRemaining = Math.max(deadlineLedger - currentLedger, 0);

    const existing = await this.aggregationRepo.findOne({
      where: { claimId },
    });

    const aggregation = this.aggregationRepo.create({
      ...(existing ?? {}),
      claimId,
      votesCast,
      approvals,
      rejections,
      quorumPercentage,
      ledgersRemaining,
      computedAt: new Date(),
    });

    return this.aggregationRepo.save(aggregation);
  }

  async getAggregation(claimId: string): Promise<ClaimAggregation | null> {
    return this.aggregationRepo.findOne({ where: { claimId } });
  }
}
