import { DataRetentionService } from './data-retention.service';

describe('DataRetentionService', () => {
  const voteDeleteMany = jest.fn();
  const claimDeleteMany = jest.fn();
  const policyDeleteMany = jest.fn();
  const rawEventDeleteMany = jest.fn();
  const ledgerCursorDeleteMany = jest.fn();

  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        vote: { deleteMany: voteDeleteMany },
        claim: { deleteMany: claimDeleteMany },
        policy: { deleteMany: policyDeleteMany },
      };
      return fn(tx);
    }),
    rawEvent: { deleteMany: rawEventDeleteMany },
    ledgerCursor: { deleteMany: ledgerCursorDeleteMany },
  };

  const config = { get: jest.fn((_k: string, def?: number) => def ?? 730) };

  let service: DataRetentionService;

  beforeEach(() => {
    jest.clearAllMocks();
    voteDeleteMany.mockResolvedValue({ count: 2 });
    claimDeleteMany.mockResolvedValue({ count: 1 });
    policyDeleteMany.mockResolvedValue({ count: 1 });
    rawEventDeleteMany.mockResolvedValue({ count: 5 });
    ledgerCursorDeleteMany.mockResolvedValue({ count: 1 });
    service = new DataRetentionService(prisma as never, config as never);
  });

  it('purgeMaterializedRowsDeletedBefore only deletes rows with deletedAt <= cutoff', async () => {
    const cutoff = new Date('2024-06-01T00:00:00.000Z');
    const summary = await service.purgeMaterializedRowsDeletedBefore(cutoff);
    expect(voteDeleteMany).toHaveBeenCalledWith({
      where: { deletedAt: { lte: cutoff } },
    });
    expect(claimDeleteMany).toHaveBeenCalledWith({
      where: { deletedAt: { lte: cutoff } },
    });
    expect(policyDeleteMany).toHaveBeenCalledWith({
      where: { deletedAt: { lte: cutoff } },
    });
    expect(summary).toEqual({ votes: 2, claims: 1, policies: 1 });
  });

  it('computeCutoff subtracts retention days from now', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const cutoff = service.computeCutoff(10);
    expect(cutoff.getTime()).toBe(now.getTime() - 10 * 86_400_000);
    jest.useRealTimers();
  });

  describe('pruneIndexerRowsBefore (issue #897)', () => {
    it('deletes RawEvent rows by ledgerClosedAt <= cutoff', async () => {
      const cutoff = new Date('2025-01-01T00:00:00.000Z');
      const summary = await service.pruneIndexerRowsBefore(cutoff);
      expect(rawEventDeleteMany).toHaveBeenCalledWith({
        where: { ledgerClosedAt: { lte: cutoff } },
      });
      expect(summary.rawEvents).toBe(5);
    });

    it('deletes LedgerCursor rows by updatedAt <= cutoff', async () => {
      const cutoff = new Date('2025-01-01T00:00:00.000Z');
      const summary = await service.pruneIndexerRowsBefore(cutoff);
      expect(ledgerCursorDeleteMany).toHaveBeenCalledWith({
        where: { updatedAt: { lte: cutoff } },
      });
      expect(summary.ledgerCursors).toBe(1);
    });

    it('returns zero counts when nothing is pruned', async () => {
      rawEventDeleteMany.mockResolvedValueOnce({ count: 0 });
      ledgerCursorDeleteMany.mockResolvedValueOnce({ count: 0 });
      const cutoff = new Date('2020-01-01T00:00:00.000Z');
      const summary = await service.pruneIndexerRowsBefore(cutoff);
      expect(summary).toEqual({ rawEvents: 0, ledgerCursors: 0 });
    });
  });
});
