import { DataRetentionService } from './data-retention.service';

describe('DataRetentionService', () => {
  const voteDeleteMany = jest.fn();
  const claimDeleteMany = jest.fn();
  const policyDeleteMany = jest.fn();

  const prisma = {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        vote: { deleteMany: voteDeleteMany },
        claim: { deleteMany: claimDeleteMany },
        policy: { deleteMany: policyDeleteMany },
      };
      return fn(tx);
    }),
  };

  const config = { get: jest.fn((_k: string, def?: number) => def ?? 730) };

  let service: DataRetentionService;

  beforeEach(() => {
    jest.clearAllMocks();
    voteDeleteMany.mockResolvedValue({ count: 2 });
    claimDeleteMany.mockResolvedValue({ count: 1 });
    policyDeleteMany.mockResolvedValue({ count: 1 });
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
});
