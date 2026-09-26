import { ReconciliationService } from './reconciliation.service';

interface MockClaim {
  id: number;
  approveVotes: number;
  rejectVotes: number;
  status?: string;
  appealsCount?: number;
  appealTxHash?: string | null;
}

function makePrisma(claims: MockClaim[]) {
  return {
    claim: {
      findMany: jest.fn().mockResolvedValue(claims),
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id: number } }) => {
        const c = claims.find((x) => x.id === where.id);
        return Promise.resolve(c ? { approveVotes: c.approveVotes, rejectVotes: c.rejectVotes } : null);
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    vote: {
      count: jest.fn(),
    },
  };
}

function makeMetrics() {
  return { recordAppealReconciliationCorrection: jest.fn() };
}

describe('ReconciliationService', () => {
  describe('runReconciliation', () => {
    it('reports ok when tallies match vote counts', async () => {
      const prisma = makePrisma([
        { id: 1, approveVotes: 2, rejectVotes: 1, status: 'REJECTED', appealsCount: 0 },
      ]);
      prisma.vote.count
        .mockResolvedValueOnce(2) // approve
        .mockResolvedValueOnce(1); // reject

      const svc = new ReconciliationService(prisma as never);
      const result = await svc.runReconciliation();

      expect(result.ok).toBe(true);
      expect(result.discrepancies).toBe(0);
      expect(result.totalChecked).toBe(1);
      expect(prisma.claim.update).not.toHaveBeenCalled();
    });

    it('detects and self-heals a tally discrepancy', async () => {
      const prisma = makePrisma([
        { id: 5, approveVotes: 3, rejectVotes: 0, status: 'PENDING', appealsCount: 0 },
      ]);
      prisma.vote.count
        .mockResolvedValueOnce(2) // actual approve (stored says 3)
        .mockResolvedValueOnce(1); // actual reject (stored says 0)

      const svc = new ReconciliationService(prisma as never);
      const result = await svc.runReconciliation();

      expect(result.ok).toBe(false);
      expect(result.discrepancies).toBe(1);
      expect(result.discrepantClaimIds).toEqual([5]);
      expect(prisma.claim.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { approveVotes: 2, rejectVotes: 1 },
      });
    });

    it('handles multiple claims with mixed results', async () => {
      const prisma = makePrisma([
        { id: 1, approveVotes: 1, rejectVotes: 0, status: 'REJECTED', appealsCount: 0 },
        {
          id: 2,
          approveVotes: 5,
          rejectVotes: 2,
          status: 'UNDER_APPEAL',
          appealsCount: 1,
          appealTxHash: '0xconfirmed',
        },
      ]);
      prisma.vote.count
        .mockResolvedValueOnce(1).mockResolvedValueOnce(0) // claim 1 ok
        .mockResolvedValueOnce(4).mockResolvedValueOnce(2); // claim 2 discrepant

      const svc = new ReconciliationService(prisma as never);
      const result = await svc.runReconciliation();

      expect(result.discrepancies).toBe(1);
      expect(result.discrepantClaimIds).toEqual([2]);
    });

    it('detects and self-heals residual appeal fields on a non-appealed claim', async () => {
      // On-chain the claim was rejected and no appeal ever opened, but an
      // optimistic submitAppealTransaction write left stale appeal bookkeeping.
      const prisma = makePrisma([
        {
          id: 7,
          approveVotes: 1,
          rejectVotes: 2,
          status: 'REJECTED',
          appealsCount: 1,
          appealTxHash: '0xdeadbeef',
        },
      ]);
      prisma.vote.count
        .mockResolvedValueOnce(1) // approve tallies match
        .mockResolvedValueOnce(2); // reject tallies match

      const metrics = makeMetrics();
      const svc = new ReconciliationService(prisma as never, metrics as never);
      const result = await svc.runReconciliation();

      expect(result.ok).toBe(false);
      expect(result.discrepancies).toBe(1);
      expect(result.discrepantClaimIds).toEqual([7]);
      expect(result.appealCorrections).toBe(1);
      expect(prisma.claim.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { appealsCount: 0, appealTxHash: null },
      });
      expect(metrics.recordAppealReconciliationCorrection).toHaveBeenCalledWith(7);
    });

    it('does not flag a claim genuinely under appeal', async () => {
      const prisma = makePrisma([
        {
          id: 9,
          approveVotes: 0,
          rejectVotes: 0,
          status: 'UNDER_APPEAL',
          appealsCount: 1,
          appealTxHash: '0xconfirmed',
        },
      ]);
      prisma.vote.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const metrics = makeMetrics();
      const svc = new ReconciliationService(prisma as never, metrics as never);
      const result = await svc.runReconciliation();

      expect(result.ok).toBe(true);
      expect(result.appealCorrections).toBe(0);
      expect(prisma.claim.update).not.toHaveBeenCalled();
      expect(metrics.recordAppealReconciliationCorrection).not.toHaveBeenCalled();
    });

    it('stores last result for getLastResult()', async () => {
      const prisma = makePrisma([]);
      const svc = new ReconciliationService(prisma as never);

      expect(svc.getLastResult()).toBeNull();
      await svc.runReconciliation();
      expect(svc.getLastResult()).not.toBeNull();
      expect(svc.getLastResult()?.ok).toBe(true);
    });
  });

  describe('getClaimReconciliationStatus', () => {
    it('returns ok=true when tallies match', async () => {
      const prisma = makePrisma([{ id: 10, approveVotes: 3, rejectVotes: 1 }]);
      prisma.vote.count
        .mockResolvedValueOnce(3) // approve
        .mockResolvedValueOnce(1); // reject

      const svc = new ReconciliationService(prisma as never);
      const status = await svc.getClaimReconciliationStatus(10);

      expect(status.ok).toBe(true);
      expect(status.storedApprove).toBe(3);
      expect(status.countApprove).toBe(3);
    });

    it('returns ok=false when tallies diverge', async () => {
      const prisma = makePrisma([{ id: 10, approveVotes: 3, rejectVotes: 1 }]);
      prisma.vote.count
        .mockResolvedValueOnce(2) // approve mismatch
        .mockResolvedValueOnce(1);

      const svc = new ReconciliationService(prisma as never);
      const status = await svc.getClaimReconciliationStatus(10);

      expect(status.ok).toBe(false);
      expect(status.storedApprove).toBe(3);
      expect(status.countApprove).toBe(2);
    });

    it('returns ok=true for non-existent claim', async () => {
      const prisma = makePrisma([]);
      prisma.vote.count.mockResolvedValue(0);

      const svc = new ReconciliationService(prisma as never);
      const status = await svc.getClaimReconciliationStatus(999);

      expect(status.ok).toBe(true);
    });
  });
});
