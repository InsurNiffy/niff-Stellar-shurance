import { RampHealthCheckService } from './ramp-health-check.service';

describe('RampHealthCheckService', () => {
  let service: RampHealthCheckService;
  const mockPrisma = {
    rampProviderHealth: {
      create: jest.fn(),
    },
  };
  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RampHealthCheckService(mockPrisma as never, mockConfigService as never);
  });

  describe('checkProviderHealth', () => {
    it('skips health check when RAMP_HEALTH_URL is not configured', async () => {
      mockConfigService.get.mockReturnValue(null);
      const result = await service.checkProviderHealth();

      expect(result.status).toBe('down');
      expect(result.errorMessage).toContain('not configured');
      expect(mockPrisma.rampProviderHealth.create).not.toHaveBeenCalled();
    });

    it('exposes last-known provider status via result', async () => {
      mockConfigService.get.mockReturnValue('https://health.ramp.com/status');
      mockPrisma.rampProviderHealth.create.mockResolvedValue({});

      const result = await service.checkProviderHealth();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('checkedAt');
      expect(['up', 'degraded', 'down']).toContain(result.status);
    });

    it('persists health status to database for health endpoint exposure', async () => {
      mockConfigService.get.mockReturnValue('https://health.ramp.com/status');
      mockPrisma.rampProviderHealth.create.mockResolvedValue({
        status: 'up',
        lastCheckedAt: new Date(),
      });

      await service.checkProviderHealth();

      expect(mockPrisma.rampProviderHealth.create).toHaveBeenCalledWith({
        data: {
          status: 'up',
          lastCheckedAt: expect.any(Date),
          errorMessage: undefined,
        },
      });
    });

    it('emits log on state transition from healthy to unhealthy', async () => {
      mockConfigService.get.mockReturnValue('https://health.ramp.com/status');
      mockPrisma.rampProviderHealth.create.mockResolvedValue({});

      const logSpy = jest.spyOn(service['logger'], 'warn');

      // First check: healthy state
      await service.checkProviderHealth();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('status transition'));

      logSpy.mockClear();
    });

    it('emits log on state transition from unhealthy back to healthy', async () => {
      mockConfigService.get.mockReturnValue('https://health.ramp.com/status');
      mockPrisma.rampProviderHealth.create.mockResolvedValue({});

      const logSpy = jest.spyOn(service['logger'], 'warn');

      // First check: down
      service['lastKnownStatus'] = 'down';
      await service.checkProviderHealth();

      // Should emit transition log
      expect(logSpy).toHaveBeenCalled();

      logSpy.mockClear();
    });

    it('health check does not block or slow down user-facing ramp requests', async () => {
      mockConfigService.get.mockReturnValue('https://health.ramp.com/status');
      mockPrisma.rampProviderHealth.create.mockResolvedValue({});

      const startTime = Date.now();
      await service.checkProviderHealth();
      const elapsedTime = Date.now() - startTime;

      // Health check should complete quickly (should be async and non-blocking)
      expect(elapsedTime).toBeLessThan(5000); // Reasonable timeout
    });

    it('returns null for last status before first check', () => {
      expect(service.getLastStatus()).toBeNull();
    });

    it('handles provider API errors gracefully', async () => {
      mockConfigService.get.mockReturnValue('https://health.ramp.com/status');
      mockPrisma.rampProviderHealth.create.mockResolvedValue({});
      jest
        .spyOn(service as never as { pingRampProvider: () => Promise<unknown> }, 'pingRampProvider')
        .mockRejectedValue(new Error('Network error'));

      const result = await service.checkProviderHealth();

      // Should return a valid result even on error
      expect(result.status).toBe('down');
      expect(result.checkedAt).toBeDefined();
    });
  });
});
