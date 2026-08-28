import { AppealFinalizeKeeperService } from './appeal-finalize-keeper.service';

describe('AppealFinalizeKeeperService', () => {
  let service: AppealFinalizeKeeperService;
  const mockPrisma = {
    claim: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockSoroban = {
    getLatestLedger: jest.fn(),
    simulateGetClaimsBatch: jest.fn(),
    finalizeAppeal: jest.fn(),
  };
  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppealFinalizeKeeperService(
      mockPrisma as never,
      mockSoroban as never,
      mockConfigService as never,
    );
  });

  describe('runFinalizationCycle', () => {
    it('correctly identifies expired vs non-expired UNDER_APPEAL claims', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
        { id: 2, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 9000 }, // Expired
        { status: 2, appeal_open_deadline_ledger: 11000 }, // Not expired
      ]);
      mockSoroban.finalizeAppeal.mockResolvedValue({
        txHash: 'deadbeef',
        ledger: 10001,
        onChainStatus: 'Approved',
      });

      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.runFinalizationCycle();

      // Should identify 1 expired claim and log the distinction
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 expired appeal'),
      );
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledWith(1);
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledTimes(1);

      logSpy.mockRestore();
    });

    it('identifies expired UNDER_APPEAL claims and calls finalize_appeal', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
        { id: 2, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 9000 }, // Expired (current=10000 > deadline=9000)
        { status: 2, appeal_open_deadline_ledger: 11000 }, // Not expired (current=10000 < deadline=11000)
      ]);
      mockSoroban.finalizeAppeal.mockResolvedValue({
        txHash: 'deadbeef',
        ledger: 10001,
        onChainStatus: 'Approved',
      });

      await service.runFinalizationCycle();

      // Should call finalize_appeal only for the expired claim (id=1)
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledWith(1);
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledTimes(1);
    });

    it('skips non-expired UNDER_APPEAL claims', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(9000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 10000 }, // Not expired
      ]);

      await service.runFinalizationCycle();

      expect(mockSoroban.finalizeAppeal).not.toHaveBeenCalled();
    });

    it('handles transient RPC failures with exponential backoff retry', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 9000 },
      ]);
      // Fail twice, then succeed
      mockSoroban.finalizeAppeal
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('RPC unavailable'))
        .mockResolvedValueOnce({
          txHash: 'deadbeef',
          ledger: 10001,
          onChainStatus: 'Approved',
        });

      await service.runFinalizationCycle();

      // Should succeed after retries
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledWith(1);
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledTimes(3); // 2 failures + 1 success
    });

    it('alerts on persistent failure after max retries', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 9000 },
      ]);
      // Fail all retries
      mockSoroban.finalizeAppeal.mockRejectedValue(new Error('Persistent RPC failure'));

      const logSpy = jest.spyOn(service['logger'], 'warn');

      await service.runFinalizationCycle();

      // Should log alert on persistent failure
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('persistent failure'),
      );
    });

    it('handles already-finalized claims gracefully', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 9000 },
      ]);
      // On-chain call fails: claim already finalized
      mockSoroban.finalizeAppeal.mockRejectedValue(
        new Error('Claim is not in UNDER_APPEAL state'),
      );

      const logSpy = jest.spyOn(service['logger'], 'debug');

      await service.runFinalizationCycle();

      // Should log but not crash the job
      expect(logSpy).toHaveBeenCalled();
      expect(mockPrisma.claim.findMany).toHaveBeenCalled();
    });

    it('is idempotent: running multiple times does not cause issues', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 9000 },
      ]);
      mockSoroban.finalizeAppeal.mockResolvedValue({
        txHash: 'deadbeef',
        ledger: 10001,
        onChainStatus: 'Approved',
      });

      // Run twice
      await service.runFinalizationCycle();
      mockSoroban.finalizeAppeal.mockResolvedValue({
        txHash: 'deadbeef2',
        ledger: 10002,
        onChainStatus: 'Approved',
      });
      await service.runFinalizationCycle();

      // Both runs should succeed (idempotent)
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledTimes(2);
    });

    it('tracks persistent failures across cycles and alerts at threshold', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 9000 },
      ]);
      // Persistent failure across cycles
      mockSoroban.finalizeAppeal.mockRejectedValue(
        new Error('Persistent RPC failure'),
      );

      const logSpy = jest.spyOn(service['logger'], 'warn');

      // First cycle: fails 3 times (retries), no alert yet
      await service.runFinalizationCycle();
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('persistent failure'),
      );

      // Second cycle: fails 3 times again, reaches threshold
      await service.runFinalizationCycle();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/ALERT.*persistent failure.*1.*Manual intervention/),
      );

      logSpy.mockRestore();
    });

    it('resets failure counter on successful finalization', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        { status: 2, appeal_open_deadline_ledger: 9000 },
      ]);

      // First call fails, then succeeds on retry
      mockSoroban.finalizeAppeal
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce({
          txHash: 'deadbeef',
          ledger: 10001,
          onChainStatus: 'Approved',
        });

      const logSpy = jest.spyOn(service['logger'], 'warn');

      await service.runFinalizationCycle();

      // Failure counter should be reset after successful retry
      // Run again with same claim still expired but now succeeds immediately
      mockSoroban.finalizeAppeal.mockResolvedValueOnce({
        txHash: 'deadbeef2',
        ledger: 10002,
        onChainStatus: 'Approved',
      });

      await service.runFinalizationCycle();

      // No persistent failure alert should occur since counter was reset
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/ALERT.*persistent failure/),
      );

      logSpy.mockRestore();
    });

    it('skips claims not found on-chain without failing the entire cycle', async () => {
      mockConfigService.get.mockReturnValue('GSOMEACCOUNT');
      mockPrisma.claim.findMany.mockResolvedValue([
        { id: 1, status: 'UNDER_APPEAL' },
        { id: 2, status: 'UNDER_APPEAL' },
      ]);
      mockSoroban.getLatestLedger.mockResolvedValue(10000);
      // One claim not found on-chain (null)
      mockSoroban.simulateGetClaimsBatch.mockResolvedValue([
        null,
        { status: 2, appeal_open_deadline_ledger: 9000 },
      ]);
      mockSoroban.finalizeAppeal.mockResolvedValue({
        txHash: 'deadbeef',
        ledger: 10001,
        onChainStatus: 'Approved',
      });

      const logSpy = jest.spyOn(service['logger'], 'debug');

      await service.runFinalizationCycle();

      // Should log debug for skipped claim
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('not found on-chain'),
      );

      // Should only finalize the one found on-chain
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledWith(2);
      expect(mockSoroban.finalizeAppeal).toHaveBeenCalledTimes(1);

      logSpy.mockRestore();
    });
  });
});
