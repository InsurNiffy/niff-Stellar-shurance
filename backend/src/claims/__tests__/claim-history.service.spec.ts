import { ClaimHistoryService } from '../../../src/claims/services/claim-history.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { TenantContextService } from '../../../src/tenant/tenant-context.service';
import { NotFoundException } from '@nestjs/common';

const FIXED_EVENTS = [
  {
    id: 1,
    txHash: 'tx1',
    eventIndex: 0,
    contractId: 'C1',
    ledger: 100,
    ledgerClosedAt: new Date('2026-01-01T00:00:00Z'),
    topic1: 'claim_filed',
    topic2: null,
    topic3: null,
    topic4: null,
    data: {},
    createdAt: new Date(),
  },
  {
    id: 2,
    txHash: 'tx1',
    eventIndex: 1,
    contractId: 'C1',
    ledger: 200,
    ledgerClosedAt: new Date('2026-01-02T00:00:00Z'),
    topic1: 'claim_approved',
    topic2: null,
    topic3: null,
    topic4: null,
    data: {},
    createdAt: new Date(),
  },
  {
    id: 3,
    txHash: 'tx1',
    eventIndex: 2,
    contractId: 'C1',
    ledger: 300,
    ledgerClosedAt: new Date('2026-01-03T00:00:00Z'),
    topic1: 'claim_pd',
    topic2: null,
    topic3: null,
    topic4: null,
    data: { actor: 'GADMIN', reason: 'Verified' },
    createdAt: new Date(),
  },
];

const mockClaim = {
  id: 42,
  txHash: 'tx1',
  createdAtLedger: 100,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  status: 'PAID',
};

function makePrisma(events = FIXED_EVENTS) {
  return {
    claim: {
      findFirst: jest.fn().mockResolvedValue(mockClaim),
    },
    rawEvent: {
      findMany: jest.fn().mockResolvedValue(events),
    },
  } as unknown as PrismaService;
}

function makeTenant(tenantId: string | null = null) {
  return { tenantId } as TenantContextService;
}

describe('ClaimHistoryService', () => {
  it('returns events in ledger order', async () => {
    const svc = new ClaimHistoryService(makePrisma(), makeTenant());
    const result = await svc.getHistory(42);

    expect(result.data).toHaveLength(3);
    expect(result.data[0].ledger).toBe(100);
    expect(result.data[0].status).toBe('pending');
    expect(result.data[1].ledger).toBe(200);
    expect(result.data[1].status).toBe('approved');
    expect(result.data[2].ledger).toBe(300);
    expect(result.data[2].status).toBe('paid');
  });

  it('includes actor and reason on admin override transitions', async () => {
    const svc = new ClaimHistoryService(makePrisma(), makeTenant());
    const result = await svc.getHistory(42);

    const paid = result.data.find((e) => e.status === 'paid');
    expect(paid?.actor).toBe('GADMIN');
    expect(paid?.reason).toBe('Verified');
  });

  it('returns nextCursor when there are more pages', async () => {
    // 3 events but limit=2 → should return cursor
    const svc = new ClaimHistoryService(makePrisma(), makeTenant());
    const result = await svc.getHistory(42, undefined, 2);

    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it('returns null nextCursor on last page', async () => {
    const svc = new ClaimHistoryService(makePrisma(), makeTenant());
    const result = await svc.getHistory(42, undefined, 100);

    expect(result.nextCursor).toBeNull();
  });

  it('uses cursor to fetch subsequent page', async () => {
    const prisma = makePrisma([FIXED_EVENTS[2]]); // only last event on page 2
    const svc = new ClaimHistoryService(prisma, makeTenant());

    // Build a cursor pointing after event id=2, ledger=200
    const cursor = Buffer.from(JSON.stringify({ ledger: 200, id: 2 })).toString('base64url');
    const result = await svc.getHistory(42, cursor, 10);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe('paid');
    expect(result.nextCursor).toBeNull();
  });

  it('throws NotFoundException for unknown claim', async () => {
    const prisma = {
      claim: { findFirst: jest.fn().mockResolvedValue(null) },
      rawEvent: { findMany: jest.fn() },
    } as unknown as PrismaService;

    const svc = new ClaimHistoryService(prisma, makeTenant());
    await expect(svc.getHistory(999)).rejects.toThrow(NotFoundException);
  });

  it('synthesizes history from claim row when no raw_events exist', async () => {
    const prisma = {
      claim: { findFirst: jest.fn().mockResolvedValue(mockClaim) },
      rawEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const svc = new ClaimHistoryService(prisma, makeTenant());
    const result = await svc.getHistory(42);

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].status).toBe('pending');
  });
});

// ── Timeline tests ───────────────────────────────────────────────────────────

const TIMELINE_LEGACY_EVENTS = [
  {
    id: 1,
    txHash: 'tx1',
    eventIndex: 0,
    contractId: 'C1',
    ledger: 100,
    ledgerClosedAt: new Date('2026-01-01T00:00:00Z'),
    topic1: 'claim_filed',
    topic2: null,
    topic3: null,
    topic4: null,
    data: {},
    createdAt: new Date(),
  },
  {
    id: 2,
    txHash: 'tx2',
    eventIndex: 0,
    contractId: 'C1',
    ledger: 200,
    ledgerClosedAt: new Date('2026-01-02T00:00:00Z'),
    topic1: 'niffyins',
    topic2: 'clm_final',
    topic3: '42',
    topic4: null,
    data: { status: 'Approved', approve_votes: 3, reject_votes: 1, at_ledger: 200 },
    createdAt: new Date(),
  },
  {
    id: 3,
    txHash: 'tx3',
    eventIndex: 0,
    contractId: 'C1',
    ledger: 300,
    ledgerClosedAt: new Date('2026-01-03T00:00:00Z'),
    topic1: 'niffyins',
    topic2: 'clm_paid',
    topic3: '42',
    topic4: null,
    data: { recipient: 'GPAID', amount: '50000000', at_ledger: 300 },
    createdAt: new Date(),
  },
  {
    id: 4,
    txHash: 'tx3',
    eventIndex: 1,
    contractId: 'C1',
    ledger: 300,
    ledgerClosedAt: new Date('2026-01-03T00:00:00Z'),
    topic1: 'niffyinsure',
    topic2: 'claim_fully_paid',
    topic3: '42',
    topic4: null,
    data: { recipient: 'GPAID', total_paid: '50000000', at_ledger: 300 },
    createdAt: new Date(),
  },
];

const TIMELINE_MIXED_EVENTS = [
  {
    id: 1,
    txHash: 'tx1',
    eventIndex: 0,
    contractId: 'C1',
    ledger: 100,
    ledgerClosedAt: new Date('2026-01-01T00:00:00Z'),
    topic1: 'claim_filed',
    topic2: null,
    topic3: null,
    topic4: null,
    data: {},
    createdAt: new Date(),
  },
  {
    id: 2,
    txHash: 'tx2',
    eventIndex: 0,
    contractId: 'C1',
    ledger: 200,
    ledgerClosedAt: new Date('2026-01-02T00:00:00Z'),
    topic1: 'niffyinsure',
    topic2: 'claim_withdrawn',
    topic3: '42',
    topic4: null,
    data: { claimant: 'GWITHDRAW', policy_id: 1, at_ledger: 200 },
    createdAt: new Date(),
  },
];

describe('ClaimHistoryService.getTimeline', () => {
  it('returns legacy events in chronological order with actor/reason as null', async () => {
    const events = [
      {
        id: 1,
        txHash: 'tx1',
        eventIndex: 0,
        contractId: 'C1',
        ledger: 100,
        ledgerClosedAt: new Date('2026-01-01T00:00:00Z'),
        topic1: 'claim_filed',
        topic2: null,
        topic3: null,
        topic4: null,
        data: {},
        createdAt: new Date(),
      },
      {
        id: 2,
        txHash: 'tx1',
        eventIndex: 1,
        contractId: 'C1',
        ledger: 200,
        ledgerClosedAt: new Date('2026-01-02T00:00:00Z'),
        topic1: 'claim_approved',
        topic2: null,
        topic3: null,
        topic4: null,
        data: {},
        createdAt: new Date(),
      },
      {
        id: 3,
        txHash: 'tx1',
        eventIndex: 2,
        contractId: 'C1',
        ledger: 300,
        ledgerClosedAt: new Date('2026-01-03T00:00:00Z'),
        topic1: 'claim_pd',
        topic2: null,
        topic3: null,
        topic4: null,
        data: {},
        createdAt: new Date(),
      },
    ];
    const prisma = makePrisma(events);
    const svc = new ClaimHistoryService(prisma, makeTenant());
    const result = await svc.getTimeline(42);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ status: 'pending', ledger: 100, timestamp: '2026-01-01T00:00:00.000Z', actor: null, reason: null });
    expect(result[1]).toEqual({ status: 'approved', ledger: 200, timestamp: '2026-01-02T00:00:00.000Z', actor: null, reason: null });
    expect(result[2]).toEqual({ status: 'paid', ledger: 300, timestamp: '2026-01-03T00:00:00.000Z', actor: null, reason: null });
  });

  it('extracts actor and reason for admin override events', async () => {
    const events = [
      {
        id: 1,
        txHash: 'tx1',
        eventIndex: 0,
        contractId: 'C1',
        ledger: 100,
        ledgerClosedAt: new Date('2026-01-01T00:00:00Z'),
        topic1: 'claim_filed',
        topic2: null,
        topic3: null,
        topic4: null,
        data: {},
        createdAt: new Date(),
      },
      {
        id: 3,
        txHash: 'tx1',
        eventIndex: 2,
        contractId: 'C1',
        ledger: 300,
        ledgerClosedAt: new Date('2026-01-03T00:00:00Z'),
        topic1: 'claim_pd',
        topic2: null,
        topic3: null,
        topic4: null,
        data: { actor: 'GADMIN', reason: 'Paid by admin' },
        createdAt: new Date(),
      },
    ];
    const prisma = makePrisma(events);
    const svc = new ClaimHistoryService(prisma, makeTenant());
    const result = await svc.getTimeline(42);

    const paid = result.find((e) => e.status === 'paid');
    expect(paid?.actor).toBe('GADMIN');
    expect(paid?.reason).toBe('Paid by admin');
  });

  it('detects contract events via topic3 claim_id lookup', async () => {
    const prisma = {
      claim: { findFirst: jest.fn().mockResolvedValue(mockClaim) },
      rawEvent: { findMany: jest.fn().mockResolvedValue(TIMELINE_LEGACY_EVENTS) },
    } as unknown as PrismaService;

    const svc = new ClaimHistoryService(prisma, makeTenant());
    const result = await svc.getTimeline(42);

    expect(result).toHaveLength(4);
    // Includes legacy txHash-based event
    expect(result[0]).toMatchObject({ status: 'pending', ledger: 100 });
    // Contract event via topic3 match
    expect(result[1]).toMatchObject({ status: 'approved', ledger: 200, reason: 'Vote majority reached' });
    expect(result[2]).toMatchObject({ status: 'paid', ledger: 300, actor: 'GPAID', reason: 'Payout processed' });
    expect(result[3]).toMatchObject({ status: 'paid', ledger: 300 });
  });

  it('maps claim_withdrawn contract events', async () => {
    const prisma = {
      claim: { findFirst: jest.fn().mockResolvedValue(mockClaim) },
      rawEvent: { findMany: jest.fn().mockResolvedValue(TIMELINE_MIXED_EVENTS) },
    } as unknown as PrismaService;

    const svc = new ClaimHistoryService(prisma, makeTenant());
    const result = await svc.getTimeline(42);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ status: 'pending', ledger: 100 });
    expect(result[1]).toMatchObject({ status: 'withdrawn', ledger: 200, actor: 'GWITHDRAW', reason: 'Claimant withdrawal' });
  });

  it('falls back to synthetic entries when no raw_events exist', async () => {
    const prisma = {
      claim: { findFirst: jest.fn().mockResolvedValue(mockClaim) },
      rawEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;

    const svc = new ClaimHistoryService(prisma, makeTenant());
    const result = await svc.getTimeline(42);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatchObject({ status: 'pending', actor: null, reason: null });
    expect(result[1]).toMatchObject({ status: 'paid', actor: null, reason: null });
  });

  it('throws NotFoundException for unknown claim', async () => {
    const prisma = {
      claim: { findFirst: jest.fn().mockResolvedValue(null) },
      rawEvent: { findMany: jest.fn() },
    } as unknown as PrismaService;

    const svc = new ClaimHistoryService(prisma, makeTenant());
    await expect(svc.getTimeline(999)).rejects.toThrow(NotFoundException);
  });
});
