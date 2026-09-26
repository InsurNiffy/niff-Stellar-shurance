import { PolicyIsActiveReconciliationService } from './policy-isactive-reconciliation.service';

function makePrisma(policies: { id: string; holderAddress: string; policyId: number; isActive: boolean }[]) {
  return {
    policy: {
      findMany: jest.fn().mockResolvedValue(policies),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

function makeSoroban(results: (Record<string, unknown> | null)[]) {
  return {
    simulateGetPoliciesBatch: jest.fn().mockResolvedValue(results),
  };
}

describe('PolicyIsActiveReconciliationService', () => {
  describe('runReconciliation', () => {
    it('reports ok when all isActive flags match on-chain state', async () => {
      const prisma = makePrisma([
        { id: 'G1:1', holderAddress: 'G1', policyId: 1, isActive: true },
      ]);
      const soroban = makeSoroban([{ is_active: true }]);

      const svc = new PolicyIsActiveReconciliationService(prisma as never, soroban as never);
      const result = await svc.runReconciliation();

      expect(result.ok).toBe(true);
      expect(result.corrected).toBe(0);
      expect(result.totalChecked).toBe(1);
      expect(prisma.policy.update).not.toHaveBeenCalled();
    });

    it('corrects a stale isActive=true when on-chain is inactive', async () => {
      const prisma = makePrisma([
        { id: 'G1:1', holderAddress: 'G1', policyId: 1, isActive: true },
      ]);
      const soroban = makeSoroban([null]);

      const svc = new PolicyIsActiveReconciliationService(prisma as never, soroban as never);
      const result = await svc.runReconciliation();

      expect(result.ok).toBe(false);
      expect(result.corrected).toBe(1);
      expect(result.correctedPolicyIds).toEqual(['G1:1']);
      expect(prisma.policy.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'G1:1' }, data: expect.objectContaining({ isActive: false }) }),
      );
    });

    it('corrects a stale isActive=false when on-chain is active', async () => {
      const prisma = makePrisma([
        { id: 'G2:2', holderAddress: 'G2', policyId: 2, isActive: false },
      ]);
      const soroban = makeSoroban([{ is_active: true }]);

      const svc = new PolicyIsActiveReconciliationService(prisma as never, soroban as never);
      const result = await svc.runReconciliation();

      expect(result.corrected).toBe(1);
      expect(prisma.policy.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }),
      );
    });

    it('skips batch and continues when simulateGetPoliciesBatch throws', async () => {
      const prisma = makePrisma([
        { id: 'G1:1', holderAddress: 'G1', policyId: 1, isActive: true },
      ]);
      const soroban = { simulateGetPoliciesBatch: jest.fn().mockRejectedValue(new Error('rpc error')) };

      const svc = new PolicyIsActiveReconciliationService(prisma as never, soroban as never);
      const result = await svc.runReconciliation();

      expect(result.ok).toBe(true);
      expect(result.corrected).toBe(0);
    });

    it('returns ok=true with no checks when SorobanService is absent', async () => {
      const prisma = makePrisma([]);
      const svc = new PolicyIsActiveReconciliationService(prisma as never);

      const result = await svc.runReconciliation();
      expect(result.ok).toBe(true);
      expect(result.totalChecked).toBe(0);
    });

    it('stores last result for getLastResult()', async () => {
      const prisma = makePrisma([]);
      const soroban = makeSoroban([]);

      const svc = new PolicyIsActiveReconciliationService(prisma as never, soroban as never);
      expect(svc.getLastResult()).toBeNull();

      await svc.runReconciliation();
      expect(svc.getLastResult()).not.toBeNull();
      expect(svc.getLastResult()?.ok).toBe(true);
    });
  });
});
