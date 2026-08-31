import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { Queue } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { getQueueRetryConfig } from '../queues/queue-config';
import { ClaimSeverity, ClaimStatus, Prisma } from '@prisma/client';

export interface BackfillJobInfo {
  jobId: string;
  fromLedger: number;
  toLedger: number;
  batchSize: number;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private reindexQueue: Queue;
  private backfillQueue: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {
    const reindexRetry = getQueueRetryConfig('reindex');
    const backfillRetry = getQueueRetryConfig('backfill');
    this.reindexQueue = new Queue('reindex', {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        attempts: reindexRetry.maxAttempts,
        backoff: reindexRetry.backoff,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
    this.backfillQueue = new Queue('backfill', {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        attempts: backfillRetry.maxAttempts,
        backoff: backfillRetry.backoff,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }

  /**
   * Reset per-network cursor so the next indexer pass starts at `fromLedger`,
   * then enqueue a BullMQ job to drive catch-up (see ReindexWorkerService).
   */
  async enqueueReindex(fromLedger: number, network: string): Promise<string> {
    const lastProcessed = Math.max(0, fromLedger - 1);
    await this.prisma.$transaction(async (tx) => {
      await tx.ledgerCursor.upsert({
        where: { network },
        create: { network, lastProcessedLedger: lastProcessed },
        update: { lastProcessedLedger: lastProcessed },
      });
    });
    const job = await this.reindexQueue.add(
      'reindex',
      { fromLedger, network },
      { jobId: `reindex-${network}-${fromLedger}-${Date.now()}` },
    );
    const jobId = job.id!;

    this.logger.log(`Reindex job enqueued: ${jobId} network=${network} fromLedger=${fromLedger}`);
    return jobId;
  }

  /**
   * Split [fromLedger, toLedger] into batchSize-sized chunks and enqueue one
   * BullMQ backfill job per chunk. Returns the created job IDs and metadata.
   * Does NOT mutate the ledger cursor — backfill is a replay-only operation.
   */
  async enqueueBackfill(
    fromLedger: number,
    toLedger: number,
    network: string,
    batchSize: number,
  ): Promise<BackfillJobInfo[]> {
    const jobs: BackfillJobInfo[] = [];
    const ts = Date.now();
    let batchIndex = 0;

    for (let start = fromLedger; start <= toLedger; start += batchSize) {
      const end = Math.min(start + batchSize - 1, toLedger);
      const jobId = `backfill-${network}-${start}-${end}-${ts}-${batchIndex}`;
      const job = await this.backfillQueue.add(
        'backfill',
        { fromLedger: start, toLedger: end, network, batchSize },
        { jobId },
      );
      jobs.push({ jobId: job.id!, fromLedger: start, toLedger: end, batchSize });
      batchIndex++;
    }

    this.logger.log(
      `Backfill enqueued: ${jobs.length} job(s) for ${network} ledgers ${fromLedger}–${toLedger}`,
    );
    return jobs;
  }

  /** Retrieve BullMQ job status from the backfill queue. */
  async getBackfillJob(jobId: string): Promise<{
    jobId: string;
    state: string;
    data: unknown;
    progress: unknown;
    failedReason?: string;
    finishedOn?: number;
    processedOn?: number;
  } | null> {
    const job = await this.backfillQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return {
      jobId: job.id!,
      state,
      data: job.data,
      progress: job.progress,
      failedReason: job.failedReason,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    };
  }

  async searchClaims(options: {
    q?: string;
    status?: string;
    severity?: string;
    claimant?: string;
    policyId?: string;
    dateFrom?: string;
    dateTo?: string;
    after?: string;
    limit?: number;
  }) {
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Build where conditions
    const where: Prisma.ClaimWhereInput = {
      deletedAt: null, // Exclude soft-deleted
    };

    // Full-text search on description (case-insensitive contains)
    if (options.q) {
      where.description = {
        contains: options.q,
        mode: 'insensitive',
      };
    }

    // Status filter
    if (options.status) {
      where.status = options.status as ClaimStatus;
    }

    // Severity filter
    if (options.severity) {
      where.severity = options.severity.toUpperCase() as ClaimSeverity;
    }

    // Claimant (creator) filter
    if (options.claimant) {
      where.creatorAddress = options.claimant;
    }

    // Policy filter
    if (options.policyId) {
      where.policyId = options.policyId;
    }

    // Date range filters
    const dateConditions: Prisma.DateTimeFilter = {};
    if (options.dateFrom) {
      dateConditions.gte = new Date(options.dateFrom);
    }
    if (options.dateTo) {
      dateConditions.lte = new Date(options.dateTo);
    }
    if (Object.keys(dateConditions).length > 0) {
      where.createdAt = dateConditions;
    }

    // Keyset pagination: decode cursor
    let skipId: number | undefined;
    if (options.after) {
      try {
        const decoded = Buffer.from(options.after, 'base64').toString('utf-8');
        skipId = parseInt(decoded, 10);
        if (Number.isNaN(skipId)) skipId = undefined;
      } catch {
        skipId = undefined;
      }
    }

    // Fetch one extra record to determine if there's a next page
    const claims = await this.prisma.claim.findMany({
      where,
      orderBy: { createdAt: 'desc', id: 'desc' },
      take: limit + 1,
      skip: skipId ? 1 : 0,
      cursor: skipId ? { id: skipId } : undefined,
    });

    const hasNextPage = claims.length > limit;
    const data = claims.slice(0, limit);
    const nextCursor = hasNextPage ? Buffer.from(String(data[data.length - 1]?.id ?? '')).toString('base64') : null;

    // Get total count
    const total = await this.prisma.claim.count({ where });

    return {
      data,
      pagination: {
        total,
        nextCursor,
        hasNextPage,
      },
    };
  }

  async setFeatureFlag(key: string, enabled: boolean, description: string | undefined, actor: string) {
    this.featureFlagsService.assertAllowlisted(key);
    const result = await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description, updatedBy: actor },
      update: { enabled, description, updatedBy: actor },
    });
    await this.featureFlagsService.refreshFlags();
    return result;
  }

  async createFeatureFlag(key: string, enabled: boolean, description: string | undefined, actor: string) {
    this.featureFlagsService.assertAllowlisted(key);
    const result = await this.prisma.featureFlag.create({
      data: { key, enabled, description: description ?? null, updatedBy: actor },
    });
    await this.featureFlagsService.refreshFlags();
    return result;
  }

  async getFeatureFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  /** Apply an array of {key, enabled} updates atomically in a single DB transaction.
   *  All keys are validated against the allowlist before the transaction begins. */
  async bulkSetFeatureFlags(
    updates: { key: string; enabled: boolean }[],
    actor: string,
  ): Promise<{ key: string; enabled: boolean }[]> {
    for (const { key } of updates) {
      this.featureFlagsService.assertAllowlisted(key);
    }

    const results = await this.prisma.$transaction(
      updates.map(({ key, enabled }) =>
        this.prisma.featureFlag.upsert({
          where: { key },
          create: { key, enabled, updatedBy: actor },
          update: { enabled, updatedBy: actor },
        }),
      ),
    );

    await this.featureFlagsService.refreshFlags();
    return results.map((r) => ({ key: r.key, enabled: r.enabled }));
  }

  async exportPoliciesCSV(options: {
    status?: string;
    holderAddress?: string;
    policyType?: string;
    dateFrom?: string;
    dateTo?: string;
    pageSize?: number;
  }) {
    const DEFAULT_PAGE_SIZE = 100;
    const pageSize = Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, 1000);

    // Build where conditions
    const where: Prisma.PolicyWhereInput = {
      deletedAt: null, // Exclude soft-deleted
    };

    // Status filter maps to isActive (active=true, inactive=false)
    if (options.status) {
      where.isActive = options.status.toLowerCase() === 'active';
    }

    if (options.holderAddress) {
      where.holderAddress = options.holderAddress;
    }

    if (options.policyType) {
      where.policyType = options.policyType;
    }

    const dateConditions: Prisma.DateTimeFilter = {};
    if (options.dateFrom) {
      dateConditions.gte = new Date(options.dateFrom);
    }
    if (options.dateTo) {
      dateConditions.lte = new Date(options.dateTo);
    }
    if (Object.keys(dateConditions).length > 0) {
      where.createdAt = dateConditions;
    }

    // CSV headers
    const headers = ['id', 'holderAddress', 'policyType', 'isActive', 'createdAt', 'updatedAt'];
    const rows: string[] = [headers.map(h => `"${h}"`).join(',')];

    // Stream rows using cursor pagination
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const policies = await this.prisma.policy.findMany({
        where,
        orderBy: { id: 'asc' },
        take: pageSize + 1,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
      });

      if (policies.length === 0) {
        hasMore = false;
        break;
      }

      hasMore = policies.length > pageSize;
      const batch = policies.slice(0, pageSize);

      for (const policy of batch) {
        rows.push([
          `"${policy.id}"`,
          `"${policy.holderAddress}"`,
          `"${policy.policyType}"`,
          `"${policy.isActive}"`,
          `"${policy.createdAt.toISOString()}"`,
          `"${policy.updatedAt.toISOString()}"`,
        ].join(','));
      }

      if (hasMore) {
        cursor = batch[batch.length - 1].id;
      }
    }

    return rows.join('\n');
  }
}
