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
  });
});
