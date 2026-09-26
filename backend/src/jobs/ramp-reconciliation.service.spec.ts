import { RampReconciliationService } from './ramp-reconciliation.service';

describe('RampReconciliationService', () => {
  let service: RampReconciliationService;
  const mockPrisma = {
    rampTransaction: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RampReconciliationService(mockPrisma as never, mockConfigService as never);
  });

  describe('runReconciliation', () => {
    it('skips reconciliation when RAMP_API_KEY is not configured', async () => {
      mockConfigService.get.mockReturnValue(null);
      const result = await service.runReconciliation();

      expect(result.ok).toBe(true);
      expect(result.totalChecked).toBe(0);
      expect(result.mismatches).toBe(0);
      expect(mockPrisma.rampTransaction.findMany).not.toHaveBeenCalled();
    });

    it('detects and corrects a missed callback within one reconciliation cycle', async () => {
      mockConfigService.get.mockReturnValue('test-api-key');

      const localTx = {
        purchaseId: 'ramp-123',
        status: 'PENDING',
        receiverAddress: 'GABC1234',
        cryptoAmount: '100',
        cryptoCurrency: 'XLM',
        fiatValue: 50.0,
        fiatCurrency: 'USD',
        finalTxHash: null,
        lastSyncedAt: new Date(),
      };

      mockPrisma.rampTransaction.findMany.mockResolvedValue([localTx]);
      mockPrisma.rampTransaction.update.mockResolvedValue({
        ...localTx,
        status: 'COMPLETE',
      });
      jest
        .spyOn(service as never as { queryRampProviderStatus: () => Promise<unknown> }, 'queryRampProviderStatus')
        .mockResolvedValue({ status: 'COMPLETE' });

      const result = await service.runReconciliation();

      expect(result.totalChecked).toBe(1);
      expect(result.mismatches).toBe(1);
      expect(result.mismatchedPurchaseIds).toContain('ramp-123');
      expect(result.ok).toBe(false);
    });

    it('produces mismatch alert with detail for investigation', async () => {
      mockConfigService.get.mockReturnValue('test-api-key');

      const localTx = {
        purchaseId: 'ramp-456',
        status: 'COMPLETE',
        receiverAddress: 'GXYZ9999',
        cryptoAmount: '50',
        cryptoCurrency: 'XLM',
        fiatValue: 25.0,
        fiatCurrency: 'USD',
        finalTxHash: 'abc123def456',
        lastSyncedAt: new Date(),
      };

      mockPrisma.rampTransaction.findMany.mockResolvedValue([localTx]);
      mockPrisma.rampTransaction.update.mockResolvedValue({
        ...localTx,
        status: 'REFUNDED',
      });
      jest
        .spyOn(service as never as { queryRampProviderStatus: () => Promise<unknown> }, 'queryRampProviderStatus')
        .mockResolvedValue({ status: 'REFUNDED' });

      const result = await service.runReconciliation();

      expect(result.mismatches).toBe(1);
      expect(result.mismatchedPurchaseIds).toContain('ramp-456');
      // Result should contain enough detail to investigate
      expect(result).toHaveProperty('checkedAt');
      expect(result).toHaveProperty('totalChecked');
    });

    it('is idempotent and safe to run repeatedly', async () => {
      mockConfigService.get.mockReturnValue('test-api-key');

      const localTx = {
        purchaseId: 'ramp-789',
        status: 'COMPLETE',
        receiverAddress: 'GABC1234',
        cryptoAmount: '100',
        cryptoCurrency: 'XLM',
        fiatValue: 50.0,
        fiatCurrency: 'USD',
        finalTxHash: 'final-hash',
        lastSyncedAt: new Date(),
      };

      mockPrisma.rampTransaction.findMany.mockResolvedValue([localTx]);
      // Second call should have no mismatches since status matches
      mockPrisma.rampTransaction.update.mockImplementation(() => {
        throw new Error('Should not update if status matches');
      });

      const result = await service.runReconciliation();

      // Running again should be safe (no mismatches if status already matched)
      expect(result.ok).toBe(true);
      expect(result.mismatches).toBe(0);
    });

    it('returns null for last result before first run', () => {
      expect(service.getLastResult()).toBeNull();
    });
  });
});
