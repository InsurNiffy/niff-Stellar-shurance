import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SorobanService } from '../rpc/soroban.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  selectParser,
  initDeploymentRegistry,
  isWarningRow,
} from '../events/parser-registry';
import { ClaimEventsService } from '../events/claim-events.service';
import { rpc as SorobanRpc, scValToNative } from '@stellar/stellar-sdk';
import { tryNormalizeAddress } from '../common/utils/normalize-address';
import { QuoteSimulationCacheService } from '../quote/quote-simulation-cache.service';
import { ClaimSummaryCacheService } from '../claims/services/claim-summary-cache.service';
import { ClaimsService } from '../claims/claims.service';
import { VotePubSubService } from '../graphql/vote-pubsub.service';
import { AdminAnalyticsService } from '../admin/admin-analytics.service';
import { OutboundWebhookService } from '../webhooks/outbound-webhook.service';
import { AllowedAssetsCacheService } from '../assets/allowed-assets-cache.service';

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
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly claimEvents?: ClaimEventsService,
    @Optional() private readonly quoteSimulationCache?: QuoteSimulationCacheService,
    @Optional() private readonly claimSummaryCache?: ClaimSummaryCacheService,
    @Optional() private readonly votePubSub?: VotePubSubService,
    @Optional() private readonly outboundWebhook?: OutboundWebhookService,
    @Optional() private readonly adminAnalytics?: AdminAnalyticsService,
    @Optional() private readonly allowedAssetsCache?: AllowedAssetsCacheService,
  ) {
    this.networkId = this.config.get<string>('STELLAR_NETWORK', 'testnet');
    this.gapThresholdLedgers = this.config.get<number>('INDEXER_GAP_ALERT_THRESHOLD_LEDGERS', 100);
    this.gapCooldownMs = this.config.get<number>('INDEXER_GAP_ALERT_COOLDOWN_MS', 3_600_000);

    // Bootstrap parser registry from env. Extend DEPLOYMENT_REGISTRY entries
    // when a new contract version is deployed (add fromLedger of the upgrade ledger).
    const contractId = this.config.get<string>('CONTRACT_ID', '');
    if (contractId) {
      initDeploymentRegistry([
        { contractId, schemaVersion: 1, fromLedger: 0 },
      ]);
    }
  }

  /** Bull reindex job: drain backlog for a network after cursor reset. */
  async processUntilCaughtUp(
    network?: string,
    _jobId?: string,
  ): Promise<{ batches: number; events: number }> {
    const net = network ?? this.networkId;
    let batches = 0;
    let events = 0;

    for (;;) {
      const r = await this.processNextBatchForNetwork(net);
      batches += 1;
      events += r.processed;

      if (r.processed === 0) break;
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

    this.metrics?.recordIndexerLag({ network, lag: gap });
    this.metrics?.recordIndexerLedgerGap({ network, gap: latestLedger - lastProcessed });

    if (lastProcessed >= latestLedger) {
      this.metrics?.recordIndexerLag({ network, lag: 0 });
      return { processed: 0, lag: 0 };
      this.metrics?.recordIndexerLedgerGap({ network, gap: 0 });
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
    this.metrics?.recordIndexerLag({ network, lag });

    const lastEvent = events.reduce((a: SorobanEvent, b: SorobanEvent) =>
      a.ledger >= b.ledger ? a : b,
    );
    this.metrics?.recordLastProcessedLedgerAge({
      network,
      ledgerClosedAt: new Date(lastEvent.ledgerClosedAt),
    });

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
        this.logger.log(
          JSON.stringify({
            event: 'indexer_ledger_gap_suppressed',
            network,
            reason: 'cooldown_active',
            cooldownRemainingMs: this.gapCooldownMs - elapsed,
          }),
        );
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
      // Detect duplicate before upsert: Prisma upsert doesn't expose whether
      // it created or updated, so we check existence first.
      const existing = await tx.rawEvent.findUnique({
        where: { txHash_eventIndex: { txHash, eventIndex: index } },
        select: { txHash: true },
      });

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

      if (existing) {
        this.metrics?.recordDuplicateEvent({ eventType: 'raw_event', network });
        await this.advanceCursorInTx(tx, network, event.ledger);
        return;
      }

      // Use the versioned parser registry for deterministic event routing.
      const parser = selectParser(contractId, event.ledger);
      const parsed = parser.parse(topics, dataNative, event.ledger, txHash);

      if (isWarningRow(parsed)) {
        this.logger.warn(
          JSON.stringify({
            event: 'unknown_event_schema',
            contractId: parsed.contractId,
            ledger: parsed.ledger,
            txHash: parsed.txHash,
            reason: parsed.reason,
          }),
        );
        await this.advanceCursorInTx(tx, network, event.ledger);
        return;
      }

      const mainTopic = topics[0]?.toString();
      const subTopic = topics[1]?.toString();

      if (mainTopic === 'PolicyInitiated' || (mainTopic === 'policy' && subTopic === 'initiated')) {
        await this.handlePolicyInitiated(tx, dataNative, event);
      } else if (mainTopic === 'policy' && subTopic === 'renewed') {
        await this.handlePolicyRenewed(tx, dataNative, event);
      } else if (
        (mainTopic === 'claim' && subTopic === 'filed') ||
        (mainTopic === 'niffyinsure' && subTopic === 'claim_filed')
      ) {
        await this.handleClaimFiled(tx, dataNative, event);
      } else if (mainTopic === 'vote') {
        await this.handleVoteCast(tx, topics, dataNative as EventPayload, event, network);
      } else if (
        mainTopic === 'claim_pd' ||
        (mainTopic === 'niffyinsure' && subTopic === 'claim_paid')
      ) {
        await this.handleClaimProcessed(tx, dataNative, event);
      } else if (mainTopic === 'niffyins' && subTopic === 'tbl_upd') {
        await this.handlePremiumTableUpdated();
      } else if (mainTopic === 'asset' && subTopic === 'added') {
        await this.handleAssetAdded(tx, dataNative, event);
      } else if (mainTopic === 'asset' && subTopic === 'removed') {
        await this.handleAssetRemoved(tx, dataNative, event);
      } else if (
        (mainTopic === 'appeal' && subTopic === 'filed') ||
        (mainTopic === 'niffyinsure' && subTopic === 'appeal_filed')
      ) {
        await this.handleAppealFiled(tx, dataNative, event);
      } else if (
        (mainTopic === 'appeal' && subTopic === 'approved') ||
        (mainTopic === 'niffyinsure' && subTopic === 'appeal_approved')
      ) {
        await this.handleAppealResolved(tx, dataNative, event, 'APPROVED');
      } else if (
        (mainTopic === 'appeal' && subTopic === 'rejected') ||
        (mainTopic === 'niffyinsure' && subTopic === 'appeal_rejected')
      ) {
        await this.handleAppealResolved(tx, dataNative, event, 'REJECTED');
      }

      await this.advanceCursorInTx(tx, network, event.ledger);
    });
  }

  private async handlePolicyInitiated(tx: IndexerTx, data: EventPayload, event: SorobanEvent) {
    const holder = tryNormalizeAddress(getStringValue(data.holder)) ?? getStringValue(data.holder);
    const policyId = getNumberValue(data.policy_id);
    const id = `${holder}:${policyId}`;

    // Extract the SEP-41 asset contract ID bound at policy initiation.
    // Present in all new PolicyInitiated events; null for legacy policies
    // created before multi-asset support was added.
    const assetContractId =
      data.asset != null && data.asset !== ''
        ? getStringValue(data.asset)
        : null;

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
        assetContractId,
        txHash: event.txHash,
        eventIndex: 0,
      },
      update: {
        isActive: true,
        endLedger: getNumberValue(data.end_ledger),
        // Only update assetContractId if the event carries one; never overwrite
        // a known asset with null (re-index safety for legacy rows).
        ...(assetContractId != null ? { assetContractId } : {}),
        updatedAt: new Date(),
      },
    });
    this.adminAnalytics?.invalidatePolicyAnalyticsCache().catch(() => undefined);
  }

  private async handlePolicyRenewed(tx: IndexerTx, data: EventPayload, _event: SorobanEvent) {
    const holder = tryNormalizeAddress(getStringValue(data.holder)) ?? getStringValue(data.holder);
    const id = `${holder}:${getNumberValue(data.policy_id)}`;
    await tx.policy.update({
      where: { id },
      data: {
        endLedger: getNumberValue(data.new_end_ledger),
        updatedAt: new Date(),
      },
    });
    this.adminAnalytics?.invalidatePolicyAnalyticsCache().catch(() => undefined);
  }

  /**
   * On-chain `ClaimFiled` carries claim_id + holder in topics and `evidence_hashes` in the value.
   * Full claim rows need policy_id / amount / URLs from `get_claim` — backfill TBD.
   */
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

    await this.claimEvents?.publish({
      claimId: String(claimId),
      status: 'PENDING',
      updatedAt: new Date().toISOString(),
      ledger: event.ledger,
    });
    await this.claimSummaryCache?.invalidateClaim(claimId);
    await this.outboundWebhook?.deliverClaimFiled(
      {
        claimId,
        policyId: policyDbId,
        creatorAddress: getStringValue(data.claimant),
        amount: getStringValue(data.amount),
        status: 'PENDING',
        txHash: event.txHash,
        ledger: event.ledger,
      },
      `claim_filed:${event.txHash}`,
    );
  }

  private async handleVoteCast(
    tx: IndexerTx,
    topics: StellarNativeValue[],
    data: EventPayload,
    event: SorobanEvent,
    network: string,
  ) {
    const claimId = Number(topics[1]);
    const voter = topics[2]?.toString();
    const option = getStringValue(data.vote ?? data);

    if (!voter) {
      this.logger.warn(`Skipping vote event for claim ${claimId}: missing voter topic`);
      return;
    }

    const existingVote = await tx.vote.findUnique({
      where: { claimId_voterAddress: { claimId, voterAddress: voter } },
      select: { claimId: true },
    });

    // Idempotent upsert — unique constraint on (claimId, voterAddress) prevents duplicates.
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

    if (existingVote) {
      this.metrics?.recordDuplicateEvent({ eventType: 'vote', network });
    }

    await tx.claim.update({
      where: { id: claimId },
      data: {
        approveVotes: getNumberValue(data.approve_votes),
        rejectVotes: getNumberValue(data.reject_votes),
      },
    });

    await this.claimEvents?.publish({
      claimId: String(claimId),
      status: 'VOTING',
      updatedAt: new Date().toISOString(),
      ledger: event.ledger,
    });
    await this.claimSummaryCache?.invalidateClaim(claimId);
    await this.votePubSub?.publishVote({
      claimId,
      voter,
      vote: option === 'Approve' ? 'yes' : 'no',
      yesVotes: getNumberValue(data.approve_votes),
      noVotes: getNumberValue(data.reject_votes),
      totalVotes: getNumberValue(data.approve_votes) + getNumberValue(data.reject_votes),
    });
    await this.outboundWebhook?.deliverVoteCast(
      {
        claimId,
        voter,
        vote: option,
        approveVotes: getNumberValue(data.approve_votes),
        rejectVotes: getNumberValue(data.reject_votes),
        txHash: event.txHash,
        ledger: event.ledger,
      },
      `vote_cast:${event.txHash}:${claimId}:${voter}`,
    );
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

    await this.claimEvents?.publish({
      claimId: String(claimId),
      status: 'PAID',
      updatedAt: new Date(event.ledgerClosedAt).toISOString(),
      ledger: event.ledger,
    });
    await this.claimSummaryCache?.invalidateClaim(claimId);
  }

  /**
   * On-chain `tbl_upd` means the premium multiplier table was updated.
   * Flush the entire quote simulation cache so subsequent requests
   * re-simulate against the new on-chain multipliers.
   */
  private async handlePremiumTableUpdated(): Promise<void> {
    await this.quoteSimulationCache?.invalidateAll();
    this.logger.log('Quote simulation cache invalidated after tbl_upd event');
  }

  private async handleAssetAdded(tx: IndexerTx, data: EventPayload, event: SorobanEvent) {
    const contractId = getStringValue(data.contract_id);
    const symbol = data.symbol != null ? getStringValue(data.symbol) : null;
    const decimals = data.decimals != null ? getNumberValue(data.decimals) : 7;

    await tx.allowedAsset.upsert({
      where: { contractId },
      create: {
        contractId,
        symbol,
        decimals,
        isAllowed: true,
        addedAtLedger: event.ledger,
      },
      update: {
        isAllowed: true,
        symbol,
        decimals,
      },
    });

    await this.allowedAssetsCache?.invalidateAll();
  }

  private async handleAssetRemoved(tx: IndexerTx, data: EventPayload, _event: SorobanEvent) {
    const contractId = getStringValue(data.contract_id);

    await tx.allowedAsset.update({
      where: { contractId },
      data: { isAllowed: false },
    });

    await this.allowedAssetsCache?.invalidateAll();
  }

  /**
   * On-chain `AppealFiled` (topics: ['appeal', 'filed']) — a claimant has
   * opened an appeal on a finalized claim. Updates the DB status to UNDER_APPEAL.
   */
  private async handleAppealFiled(tx: IndexerTx, data: EventPayload, event: SorobanEvent) {
    const claimId = getNumberValue(data.claim_id);

    await tx.claim.updateMany({
      where: { id: claimId, deletedAt: null },
      data: {
        status: 'UNDER_APPEAL',
        updatedAtLedger: event.ledger,
      },
    });

    await this.claimEvents?.publish({
      claimId: String(claimId),
      status: 'UNDER_APPEAL',
      updatedAt: new Date(event.ledgerClosedAt).toISOString(),
      ledger: event.ledger,
    });
    await this.claimSummaryCache?.invalidateClaim(claimId);
  }

  /**
   * On-chain `AppealApproved` or `AppealRejected` — the appeal has been
   * resolved. Updates the DB status and records appeal-outcome metrics.
   *
   * @param outcome - 'APPROVED' or 'REJECTED'
   */
  private async handleAppealResolved(
    tx: IndexerTx,
    data: EventPayload,
    event: SorobanEvent,
    outcome: 'APPROVED' | 'REJECTED',
  ) {
    const claimId = getNumberValue(data.claim_id);
    const updatedAt = new Date(event.ledgerClosedAt).toISOString();

    await tx.claim.updateMany({
      where: { id: claimId, deletedAt: null },
      data: {
        status: outcome,
        isFinalized: true,
        updatedAtLedger: event.ledger,
      },
    });

    // Record appeal resolution metrics (task #1328)
    if (outcome === 'APPROVED') {
      this.metrics?.recordAppealApproved();
    } else {
      this.metrics?.recordAppealRejected();
    }

    // Push live status to GET /claims/status/stream subscribers (#1326).
    ClaimsService.publishStatusChange({
      claimId: String(claimId),
      status: outcome.toLowerCase(),
      updatedAt,
    });

    await this.claimEvents?.publish({
      claimId: String(claimId),
      status: outcome,
      updatedAt,
      ledger: event.ledger,
    });
    await this.claimSummaryCache?.invalidateClaim(claimId);
  }
}
