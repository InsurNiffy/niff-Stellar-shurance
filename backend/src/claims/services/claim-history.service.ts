import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../tenant/tenant-context.service';
import { claimTenantWhere } from '../../tenant/tenant-filter.helper';
import type { ClaimTimelineEntryDto } from '../dto/claim.dto';

export interface ClaimHistoryEntry {
  status: string;
  ledger: number;
  timestamp: string;
  actor?: string;
  reason?: string;
}

export interface ClaimHistoryPage {
  data: ClaimHistoryEntry[];
  nextCursor: string | null;
}

// Legacy status-change event topic patterns (topic1 holds the status directly)
const LEGACY_TOPICS = ['claim_pd', 'claim_filed', 'claim_approved', 'claim_rejected', 'claim_withdrawn'];

// Contract event patterns where topic1 = namespace, topic2 = event name
const CONTRACT_CLAIM_NAMESPACE = 'niffyins';
const CONTRACT_CLAIM_EVENTS = ['clm_filed', 'claim_status_changed', 'clm_final', 'clm_paid'];
const CONTRACT_POLICY_NAMESPACE = 'niffyinsure';
const CONTRACT_POLICY_EVENTS = [
  'claim_withdrawn',
  'claim_fully_paid',
  // Appeal open / resolve (#1324) — canonical contract topics + legacy indexer aliases
  'appeal_opened',
  'appeal_resolved',
  'appeal_filed',
  'appeal_approved',
  'appeal_rejected',
];

// Legacy appeal topic pairs (topic1=namespace, topic2=event) also seen in indexer
const LEGACY_APPEAL_TOPIC1 = 'appeal';
const LEGACY_APPEAL_EVENTS = ['filed', 'approved', 'rejected'];

@Injectable()
export class ClaimHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  async getHistory(
    claimId: number,
    cursor?: string,
    limit = 20,
  ): Promise<ClaimHistoryPage> {
    const tenantId = this.tenantCtx.tenantId;

    // Verify claim exists and belongs to tenant
    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(tenantId, { id: claimId }),
      select: { id: true, txHash: true, createdAtLedger: true, createdAt: true, status: true },
    });
    if (!claim) throw new NotFoundException(`Claim ${claimId} not found`);

    const take = Math.min(Math.max(1, limit), 100);

    // Decode cursor: base64url-encoded ledger number
    let afterLedger: number | undefined;
    let afterId: number | undefined;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
          ledger: number;
          id: number;
        };
        afterLedger = decoded.ledger;
        afterId = decoded.id;
      } catch {
        // ignore invalid cursor — start from beginning
      }
    }

    // Query raw_events for this claim's txHash and status-change topics
    const events = await this.prisma.rawEvent.findMany({
      where: {
        txHash: claim.txHash ?? undefined,
        ...(afterLedger !== undefined && afterId !== undefined
          ? {
              OR: [
                { ledger: { gt: afterLedger } },
                { ledger: afterLedger, id: { gt: afterId } },
              ],
            }
          : {}),
        OR: LEGACY_TOPICS.map((t) => ({ topic1: t })),
      },
      orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
      take: take + 1,
    });

    // Also include the initial filed event by claim's own txHash
    const hasMore = events.length > take;
    const page = hasMore ? events.slice(0, take) : events;

    const data: ClaimHistoryEntry[] = page.map((e) => {
      const raw = e.data as Record<string, unknown>;
      return {
        status: mapTopicToStatus(e.topic1 ?? ''),
        ledger: e.ledger,
        timestamp: e.ledgerClosedAt.toISOString(),
        actor: typeof raw['actor'] === 'string' ? raw['actor'] : undefined,
        reason: typeof raw['reason'] === 'string' ? raw['reason'] : undefined,
      };
    });

    // If no raw_events found, synthesize from the claim row itself
    if (data.length === 0 && !cursor) {
      data.push({
        status: 'pending',
        ledger: claim.createdAtLedger,
        timestamp: claim.createdAt.toISOString(),
      });
      if (claim.status !== 'PENDING') {
        data.push({
          status: claim.status.toLowerCase(),
          ledger: claim.createdAtLedger,
          timestamp: claim.createdAt.toISOString(),
        });
      }
    }

    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ ledger: last.ledger, id: last.id }),
      ).toString('base64url');
    }

    return { data, nextCursor };
  }

  /**
   * Returns a chronological status-transition timeline for a claim,
   * populated from indexed RawEvent rows.  Unlike getHistory() which
   * only looks at the filing txHash, this method also finds events
   * by claim_id in topic3 (the Soroban convention for claim events).
   * Missing actor / reason are returned as null rather than omitted.
   */
  async getTimeline(claimId: number): Promise<ClaimTimelineEntryDto[]> {
    const tenantId = this.tenantCtx.tenantId;

    const claim = await this.prisma.claim.findFirst({
      where: claimTenantWhere(tenantId, { id: claimId }),
      select: {
        id: true,
        txHash: true,
        createdAtLedger: true,
        createdAt: true,
        status: true,
        appealsCount: true,
        appealTxHash: true,
        updatedAt: true,
        updatedAtLedger: true,
      },
    });
    if (!claim) throw new NotFoundException(`Claim ${claimId} not found`);

    // Find events linked to this claim:
    //   1. Legacy events sharing the same txHash
    //   2. Contract events where topic3 holds the claim_id
    //   3. Appeal open/resolve events (#1324)
    const claimIdStr = String(claimId);

    const events = await this.prisma.rawEvent.findMany({
      where: {
        OR: [
          // Legacy: events with same txHash and direct topic1 status values
          {
            txHash: claim.txHash ?? undefined,
            topic1: { in: LEGACY_TOPICS },
          },
          // Contract: niffyins namespace events (claim_id in topic3)
          {
            topic1: CONTRACT_CLAIM_NAMESPACE,
            topic2: { in: CONTRACT_CLAIM_EVENTS },
            topic3: claimIdStr,
          },
          // Contract: niffyinsure namespace events (claim_id in topic3)
          {
            topic1: CONTRACT_POLICY_NAMESPACE,
            topic2: { in: CONTRACT_POLICY_EVENTS },
            topic3: claimIdStr,
          },
          // Legacy appeal topic layout: topic1=appeal, topic2=filed|approved|rejected
          {
            topic1: LEGACY_APPEAL_TOPIC1,
            topic2: { in: LEGACY_APPEAL_EVENTS },
            topic3: claimIdStr,
          },
        ],
      },
      orderBy: [{ ledger: 'asc' }, { id: 'asc' }],
    });

    const data: ClaimTimelineEntryDto[] = events.map((e) => {
      const raw = e.data as Record<string, unknown>;
      return {
        status: mapRawEventToStatus(e.topic1, e.topic2, raw),
        ledger: e.ledger,
        timestamp: e.ledgerClosedAt.toISOString(),
        actor: extractActor(e.topic1, e.topic2, e.topic4, raw),
        reason: extractReason(e.topic1, e.topic2, raw),
      };
    });

    // Fallback: synthesize from the claim row if no raw_events found
    if (data.length === 0) {
      data.push({
        status: 'pending',
        ledger: claim.createdAtLedger,
        timestamp: claim.createdAt.toISOString(),
        actor: null,
        reason: null,
      });
      if (claim.status !== 'PENDING') {
        data.push({
          status: claim.status.toLowerCase(),
          ledger: claim.createdAtLedger,
          timestamp: claim.createdAt.toISOString(),
          actor: null,
          reason: null,
        });
      }
    }

    // When indexed appeal events are missing but the claim row shows an appeal
    // was opened / resolved, append synthetic appeal transitions (#1324).
    appendSyntheticAppealTransitions(data, claim);

    return data;
  }
}

function mapTopicToStatus(topic: string): string {
  switch (topic) {
    case 'claim_filed':
      return 'pending';
    case 'claim_approved':
      return 'approved';
    case 'claim_pd':
    case 'claim_paid':
      return 'paid';
    case 'claim_rejected':
      return 'rejected';
    default:
      return topic.toLowerCase();
  }
}

/** Map a raw event's topic values to a claim status string. */
function mapRawEventToStatus(
  topic1: string | null,
  topic2: string | null,
  data: Record<string, unknown>,
): string {
  const t1 = topic1 ?? '';
  const t2 = topic2 ?? '';

  // Legacy: topic1 is the status key directly
  if (t1 === 'claim_filed') return 'pending';
  if (t1 === 'claim_approved') return 'approved';
  if (t1 === 'claim_rejected') return 'rejected';
  if (t1 === 'claim_pd' || t1 === 'claim_paid') return 'paid';
  if (t1 === 'claim_withdrawn') return 'withdrawn';

  // Contract events: namespace in topic1, event name in topic2
  if (t1 === 'niffyins') {
    if (t2 === 'clm_filed') return 'pending';
    if (t2 === 'claim_status_changed') {
      const s = data['new_status'];
      return typeof s === 'string' ? s.toLowerCase() : 'unknown';
    }
    if (t2 === 'clm_final') {
      const s = data['status'];
      return typeof s === 'string' ? s.toLowerCase() : 'unknown';
    }
    if (t2 === 'clm_paid') return 'paid';
  }
  if (t1 === 'niffyinsure') {
    if (t2 === 'claim_withdrawn') return 'withdrawn';
    if (t2 === 'claim_fully_paid') return 'paid';
    if (t2 === 'appeal_opened' || t2 === 'appeal_filed') return 'under_appeal';
    if (t2 === 'appeal_approved') return 'appeal_approved';
    if (t2 === 'appeal_rejected') return 'appeal_rejected';
    if (t2 === 'appeal_resolved') {
      const outcome = data['outcome'] ?? data['new_status'] ?? data['status'];
      if (typeof outcome === 'string') {
        const lower = outcome.toLowerCase();
        if (lower.includes('approv')) return 'appeal_approved';
        if (lower.includes('reject')) return 'appeal_rejected';
        return lower;
      }
      return 'appeal_resolved';
    }
  }

  // Legacy appeal namespace: topic1=appeal, topic2=filed|approved|rejected
  if (t1 === 'appeal') {
    if (t2 === 'filed') return 'under_appeal';
    if (t2 === 'approved') return 'appeal_approved';
    if (t2 === 'rejected') return 'appeal_rejected';
  }

  return (t2 || t1).toLowerCase();
}

/** Extract the actor address from event data / topics. */
function extractActor(
  topic1: string | null,
  topic2: string | null,
  topic4: string | null,
  data: Record<string, unknown>,
): string | null {
  // Admin override enrichment
  if (typeof data['actor'] === 'string') return data['actor'];

  const t1 = topic1 ?? '';
  const t2 = topic2 ?? '';

  if (t1 === 'niffyins') {
    // clm_filed: holder is in topic[3] (topic4 column)
    if (t2 === 'clm_filed') return topic4;
    // clm_paid: recipient is in data
    if (t2 === 'clm_paid') return typeof data['recipient'] === 'string' ? data['recipient'] : null;
  }
  if (t1 === 'niffyinsure') {
    if (t2 === 'claim_withdrawn') return typeof data['claimant'] === 'string' ? data['claimant'] : null;
    if (t2 === 'claim_fully_paid') return typeof data['recipient'] === 'string' ? data['recipient'] : null;
    if (
      t2 === 'appeal_opened' ||
      t2 === 'appeal_filed' ||
      t2 === 'appeal_resolved' ||
      t2 === 'appeal_approved' ||
      t2 === 'appeal_rejected'
    ) {
      return typeof data['claimant'] === 'string' ? data['claimant'] : null;
    }
  }
  if (t1 === 'appeal') {
    return typeof data['claimant'] === 'string' ? data['claimant'] : null;
  }

  return null;
}

/** Extract a human-readable reason from event data / type. */
function extractReason(
  topic1: string | null,
  topic2: string | null,
  data: Record<string, unknown>,
): string | null {
  // Admin override enrichment
  if (typeof data['reason'] === 'string') return data['reason'];

  const t1 = topic1 ?? '';
  const t2 = topic2 ?? '';

  if (t1 === 'niffyins') {
    if (t2 === 'clm_final') {
      const status = data['status'];
      if (status === 'Approved') return 'Vote majority reached';
      if (status === 'Rejected') return 'Vote majority rejected';
    }
    if (t2 === 'clm_paid') return 'Payout processed';
  }
  if (t1 === 'niffyinsure') {
    if (t2 === 'claim_withdrawn') return 'Claimant withdrawal';
    if (t2 === 'claim_fully_paid') return 'Fully paid';
    if (t2 === 'appeal_opened' || t2 === 'appeal_filed') return 'Appeal opened';
    if (t2 === 'appeal_approved') return 'Appeal approved';
    if (t2 === 'appeal_rejected') return 'Appeal rejected';
    if (t2 === 'appeal_resolved') {
      const outcome = data['outcome'] ?? data['new_status'] ?? data['status'];
      if (typeof outcome === 'string') {
        const lower = outcome.toLowerCase();
        if (lower.includes('approv')) return 'Appeal approved';
        if (lower.includes('reject')) return 'Appeal rejected';
      }
      return 'Appeal resolved';
    }
  }
  if (t1 === 'appeal') {
    if (t2 === 'filed') return 'Appeal opened';
    if (t2 === 'approved') return 'Appeal approved';
    if (t2 === 'rejected') return 'Appeal rejected';
  }

  return null;
}

/**
 * Ensure appeal open/resolve transitions appear even when RawEvent rows are
 * missing (e.g. indexer lag) but the claim row already reflects an appeal (#1324).
 */
function appendSyntheticAppealTransitions(
  data: ClaimTimelineEntryDto[],
  claim: {
    status: string;
    appealsCount: number | null;
    appealTxHash: string | null;
    updatedAt: Date;
    updatedAtLedger: number | null;
    createdAtLedger: number;
  },
): void {
  const hasAppealOpen = data.some((e) => e.status === 'under_appeal');
  const hasAppealResolve = data.some(
    (e) => e.status === 'appeal_approved' || e.status === 'appeal_rejected',
  );
  const appealed =
    (claim.appealsCount ?? 0) > 0 ||
    Boolean(claim.appealTxHash) ||
    claim.status === 'UNDER_APPEAL';

  if (!appealed) return;

  const ledger = claim.updatedAtLedger ?? claim.createdAtLedger;
  const timestamp = claim.updatedAt.toISOString();

  if (!hasAppealOpen) {
    data.push({
      status: 'under_appeal',
      ledger,
      timestamp,
      actor: null,
      reason: 'Appeal opened',
    });
  }

  if (
    !hasAppealResolve &&
    (claim.status === 'APPROVED' || claim.status === 'REJECTED') &&
    (claim.appealsCount ?? 0) > 0
  ) {
    data.push({
      status: claim.status === 'APPROVED' ? 'appeal_approved' : 'appeal_rejected',
      ledger,
      timestamp,
      actor: null,
      reason: claim.status === 'APPROVED' ? 'Appeal approved' : 'Appeal rejected',
    });
  }

  data.sort((a, b) => a.ledger - b.ledger || a.timestamp.localeCompare(b.timestamp));
}
