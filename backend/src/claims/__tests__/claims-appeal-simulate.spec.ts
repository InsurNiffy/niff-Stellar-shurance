import { ClaimsService } from '../claims.service';
import { AppealSimulationCacheService } from '../services/appeal-simulation-cache.service';
import { NotFoundException } from '@nestjs/common';

describe('ClaimsService.simulateAppealTransaction (#1327)', () => {
  const wallet = 'GWALLET';
  const claimId = 42;
  const built = {
    unsignedXdr: 'SHOULD_NOT_BE_CACHED',
    minResourceFee: '100',
    baseFee: '100',
    totalEstimatedFee: '200',
    totalEstimatedFeeXlm: '0.00002',
    authRequirements: [],
    memoConvention: 'n/a',
    currentLedger: 1234,
  };

  function makeService(opts?: {
    cacheHit?: typeof built extends never ? never : object | null;
    claim?: object | null;
  }) {
    const soroban = {
      buildAppealTransaction: jest.fn().mockResolvedValue(built),
    };
    const appealSimulationCache = {
      get: jest.fn().mockResolvedValue(opts?.cacheHit ?? null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      claim: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.claim === undefined ? { id: claimId } : opts.claim,
        ),
      },
    };
    const tenantCtx = { tenantId: null };

    const svc = new ClaimsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { get: jest.fn((_: string, d: unknown) => d) } as never,
      soroban as never,
      tenantCtx as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      appealSimulationCache as unknown as AppealSimulationCacheService,
    );

    return { svc, soroban, appealSimulationCache, prisma };
  }

  it('calls RPC on cache miss and stores fee metadata without unsignedXdr', async () => {
    const { svc, soroban, appealSimulationCache } = makeService();
    const result = await svc.simulateAppealTransaction({ claimId, walletAddress: wallet });

    expect(soroban.buildAppealTransaction).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(false);
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('unsignedXdr');
    expect(appealSimulationCache.set).toHaveBeenCalledWith(
      claimId,
      wallet,
      expect.not.objectContaining({ unsignedXdr: expect.anything() }),
    );
  });

  it('avoids RPC on cache hit within TTL window', async () => {
    const cached = {
      ok: true as const,
      claimId,
      walletAddress: wallet,
      minResourceFee: '100',
      baseFee: '100',
      totalEstimatedFee: '200',
      totalEstimatedFeeXlm: '0.00002',
      currentLedger: 1234,
    };
    const { svc, soroban, appealSimulationCache } = makeService({ cacheHit: cached });
    const result = await svc.simulateAppealTransaction({ claimId, walletAddress: wallet });

    expect(result.cached).toBe(true);
    expect(soroban.buildAppealTransaction).not.toHaveBeenCalled();
    expect(appealSimulationCache.set).not.toHaveBeenCalled();
  });

  it('buildAppealTransaction always hits Soroban (never reads simulate cache)', async () => {
    const { svc, soroban, appealSimulationCache } = makeService({
      cacheHit: {
        ok: true,
        claimId,
        walletAddress: wallet,
        minResourceFee: '1',
        baseFee: '1',
        totalEstimatedFee: '2',
        totalEstimatedFeeXlm: '0',
        currentLedger: 1,
      },
    });

    await svc.buildAppealTransaction({
      claimant: wallet,
      claimId,
      reason: 'Fresh build',
    });

    expect(soroban.buildAppealTransaction).toHaveBeenCalledTimes(1);
    expect(appealSimulationCache.get).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when claim is missing', async () => {
    const { svc } = makeService({ claim: null });
    await expect(
      svc.simulateAppealTransaction({ claimId, walletAddress: wallet }),
    ).rejects.toThrow(NotFoundException);
  });
});
