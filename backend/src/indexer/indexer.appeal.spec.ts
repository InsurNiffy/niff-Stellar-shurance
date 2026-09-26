/**
 * Indexer appeal event sequence (#1318).
 *
 * Fixture: Rejected claim → AppealOpened (+ UnderAppeal status) → AppealResolved
 * (AppealApproved). Asserts Claim row status / appealsCount reconcile with the
 * optimistic API write path (no double-increment when already UNDER_APPEAL).
 */

import { ConfigService } from '@nestjs/config';
import { IndexerService } from './indexer.service';
import { MetricsService } from '../metrics/metrics.service';

const scValToNative = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk') as Record<string, unknown>;
  return {
    ...actual,
    scValToNative: (...args: unknown[]) => scValToNative(...args),
  };
});

jest.mock('../events/parser-registry', () => {
  const actual = jest.requireActual('../events/parser-registry') as Record<string, unknown>;
  return {
    ...actual,
    isWarningRow: jest.fn(() => false),
    selectParser: jest.fn(() => ({
      parse: jest.fn(() => ({ kind: 'parsed' })),
    })),
  };
});

const NETWORK = 'testnet';
const CLAIM_ID = 42;

function makeConfig() {
  return {
    get: jest.fn((key: string, def?: unknown) => {
      if (key === 'STELLAR_NETWORK') return NETWORK;
      if (key === 'INDEXER_GAP_ALERT_THRESHOLD_LEDGERS') return 100;
      if (key === 'INDEXER_GAP_ALERT_COOLDOWN_MS') return 3_600_000;
      return def;
    }),
  } as unknown as ConfigService;
}

function makeMetrics() {
  return {
    recordIndexerLag: jest.fn(),
    recordDuplicateEvent: jest.fn(),
    recordAppealApproved: jest.fn(),
    recordAppealRejected: jest.fn(),
  } as unknown as MetricsService;
}

type ClaimRow = {
  id: number;
  status: string;
  appealsCount: number;
  isFinalized: boolean;
  updatedAtLedger: number;
  deletedAt: null;
};

function makePrisma(claim: ClaimRow) {
  const rawEvents = new Map<string, Record<string, unknown>>();
  const rawEventKey = (txHash: string, eventIndex: number) => `${txHash}:${eventIndex}`;

  const txOps = {
    rawEvent: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { txHash_eventIndex: { txHash: string; eventIndex: number } };
        }) => {
          const k = rawEventKey(where.txHash_eventIndex.txHash, where.txHash_eventIndex.eventIndex);
          return Promise.resolve(rawEvents.get(k) ?? null);
        },
      ),
      upsert: jest.fn(
        ({
          where,
          create,
        }: {
          where: { txHash_eventIndex: { txHash: string; eventIndex: number } };
          create: Record<string, unknown>;
        }) => {
          const k = rawEventKey(where.txHash_eventIndex.txHash, where.txHash_eventIndex.eventIndex);
          if (!rawEvents.has(k)) rawEvents.set(k, { ...create });
          return Promise.resolve(rawEvents.get(k));
        },
      ),
    },
    claim: {
      findFirst: jest.fn(() =>
        Promise.resolve(claim.deletedAt ? null : { ...claim }),
      ),
      updateMany: jest.fn(
        ({ data }: { data: Record<string, unknown> }) => {
          if (typeof data.status === 'string') claim.status = data.status;
          if (typeof data.isFinalized === 'boolean') claim.isFinalized = data.isFinalized;
          if (typeof data.updatedAtLedger === 'number') {
            claim.updatedAtLedger = data.updatedAtLedger;
          }
          const inc = data.appealsCount as { increment?: number } | undefined;
          if (inc && typeof inc.increment === 'number') {
            claim.appealsCount += inc.increment;
          }
          return Promise.resolve({ count: 1 });
        },
      ),
      upsert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    ledgerCursor: {
      findUnique: jest.fn().mockResolvedValue({ lastProcessedLedger: 0 }),
      upsert: jest.fn(),
    },
  };

  const prisma = {
    ledgerCursor: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ network: NETWORK, lastProcessedLedger: 0, updatedAt: new Date() }),
      create: jest.fn(),
    },
    indexerState: { findFirst: jest.fn() },
    ledgerGapAlertDedup: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof txOps) => Promise<void>) => fn(txOps)),
    _claim: claim,
    _txOps: txOps,
    _rawEvents: rawEvents,
  };

  return prisma;
}

function makeEvent(txHash: string, ledger: number, topics: unknown[], value: unknown) {
  let call = 0;
  // processEventForNetwork maps topics then value via scValToNative
  const natives = [...topics, value];
  scValToNative.mockImplementation(() => {
    const next = natives[call] ?? {};
    call += 1;
    return next;
  });

  return {
    txHash,
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    topic: topics.map(() => ({})),
    value: {},
    contractId: { toString: () => 'CONTRACT_APPEAL' },
  };
}

function makeSoroban(events: unknown[]) {
  return {
    getLatestLedger: jest.fn().mockResolvedValue(200),
    getEvents: jest.fn().mockResolvedValue({ events }),
  };
}

describe('indexer appeal event sequence (#1318)', () => {
  beforeEach(() => {
    scValToNative.mockReset();
  });

  it('persists UNDER_APPEAL + appealsCount from AppealOpened when API did not write', async () => {
    const claim: ClaimRow = {
      id: CLAIM_ID,
      status: 'REJECTED',
      appealsCount: 0,
      isFinalized: true,
      updatedAtLedger: 1000,
      deletedAt: null,
    };
    const prisma = makePrisma(claim);
    const metrics = makeMetrics();
    const event = makeEvent(
      'tx_appeal_open',
      5000,
      ['niffyinsure', 'appeal_opened', CLAIM_ID],
      {
        policy_id: 3,
        claimant: 'GTEST',
        appeal_deadline_ledger: 5100,
        quorum_bps: 7500,
        at_ledger: 5000,
      },
    );
    const soroban = makeSoroban([event]);
    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);

    await svc.processNextBatchForNetwork(NETWORK);

    expect(claim.status).toBe('UNDER_APPEAL');
    expect(claim.appealsCount).toBe(1);
    expect(claim.updatedAtLedger).toBe(5000);
  });

  it('does not double-increment appealsCount when optimistic API write already applied', async () => {
    const claim: ClaimRow = {
      id: CLAIM_ID,
      status: 'UNDER_APPEAL',
      appealsCount: 1,
      isFinalized: false,
      updatedAtLedger: 4999,
      deletedAt: null,
    };
    const prisma = makePrisma(claim);
    const metrics = makeMetrics();
    const event = makeEvent(
      'tx_appeal_open_opt',
      5001,
      ['niffyinsure', 'appeal_opened', CLAIM_ID],
      {
        policy_id: 3,
        claimant: 'GTEST',
        appeal_deadline_ledger: 5100,
        quorum_bps: 7500,
        at_ledger: 5001,
      },
    );
    const soroban = makeSoroban([event]);
    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);

    await svc.processNextBatchForNetwork(NETWORK);

    expect(claim.status).toBe('UNDER_APPEAL');
    expect(claim.appealsCount).toBe(1);
  });

  it('applies ClaimStatusChanged(UnderAppeal) then AppealResolved(AppealApproved)', async () => {
    const claim: ClaimRow = {
      id: CLAIM_ID,
      status: 'REJECTED',
      appealsCount: 0,
      isFinalized: true,
      updatedAtLedger: 1000,
      deletedAt: null,
    };
    const prisma = makePrisma(claim);
    const metrics = makeMetrics();

    const statusOpen = makeEvent(
      'tx_status_under_appeal',
      6000,
      ['niffyins', 'claim_status_changed', CLAIM_ID],
      {
        version: 1,
        old_status: 'Rejected',
        new_status: 'UnderAppeal',
        at_ledger: 6000,
      },
    );
    // Remake scVal mock for second event after first batch would reset — process both in one batch
    const natives = [
      'niffyins',
      'claim_status_changed',
      CLAIM_ID,
      {
        version: 1,
        old_status: 'Rejected',
        new_status: 'UnderAppeal',
        at_ledger: 6000,
      },
      'niffyinsure',
      'appeal_resolved',
      CLAIM_ID,
      {
        policy_id: 3,
        claimant: 'GTEST',
        outcome: 'AppealApproved',
        approve_votes: 5,
        reject_votes: 1,
        at_ledger: 6050,
      },
    ];
    let call = 0;
    scValToNative.mockImplementation(() => natives[call++]);

    const resolveEvent = {
      txHash: 'tx_appeal_resolved',
      ledger: 6050,
      ledgerClosedAt: new Date().toISOString(),
      topic: [{}, {}, {}],
      value: {},
      contractId: { toString: () => 'CONTRACT_APPEAL' },
    };

    // First event already built; rebuild statusOpen with shared mock sequence
    const openEvent = {
      ...statusOpen,
      topic: [{}, {}, {}],
      value: {},
    };

    const soroban = makeSoroban([openEvent, resolveEvent]);
    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);

    await svc.processNextBatchForNetwork(NETWORK);

    expect(claim.status).toBe('APPEAL_APPROVED');
    expect(claim.isFinalized).toBe(true);
    expect(claim.appealsCount).toBe(1);
    expect(metrics.recordAppealApproved).toHaveBeenCalledTimes(1);
  });

  it('maps claim_status_changed(AppealRejected) without double-counting metrics', async () => {
    const claim: ClaimRow = {
      id: CLAIM_ID,
      status: 'UNDER_APPEAL',
      appealsCount: 1,
      isFinalized: false,
      updatedAtLedger: 6000,
      deletedAt: null,
    };
    const prisma = makePrisma(claim);
    const metrics = makeMetrics();
    const event = makeEvent(
      'tx_status_rejected',
      6100,
      ['niffyins', 'claim_status_changed', CLAIM_ID],
      {
        version: 1,
        old_status: 'UnderAppeal',
        new_status: 'AppealRejected',
        at_ledger: 6100,
      },
    );
    const soroban = makeSoroban([event]);
    const svc = new IndexerService(prisma as never, soroban as never, makeConfig(), metrics);

    await svc.processNextBatchForNetwork(NETWORK);
    expect(claim.status).toBe('APPEAL_REJECTED');
    expect(metrics.recordAppealRejected).toHaveBeenCalledTimes(1);

    // Replay of a second terminal event with same status should not re-record
    const event2 = makeEvent(
      'tx_status_rejected_2',
      6101,
      ['niffyinsure', 'appeal_resolved', CLAIM_ID],
      {
        policy_id: 3,
        claimant: 'GTEST',
        outcome: 'AppealRejected',
        approve_votes: 1,
        reject_votes: 4,
        at_ledger: 6101,
      },
    );
    (soroban.getEvents as jest.Mock).mockResolvedValue({ events: [event2] });
    await svc.processNextBatchForNetwork(NETWORK);

    expect(claim.status).toBe('APPEAL_REJECTED');
    expect(metrics.recordAppealRejected).toHaveBeenCalledTimes(1);
  });
});
