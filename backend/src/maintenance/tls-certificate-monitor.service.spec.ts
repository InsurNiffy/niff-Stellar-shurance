import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TlsCertificateMonitorService } from './tls-certificate-monitor.service';
import { CertificateCheckerService, CertificateCheckResult } from '../common/tls/certificate-checker.service';
import { RedisService } from '../cache/redis.service';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('TlsCertificateMonitorService', () => {
  let service: TlsCertificateMonitorService;
  let configService: ConfigService;
  let certChecker: CertificateCheckerService;
  let redis: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TlsCertificateMonitorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config: Record<string, any> = {
                TLS_CERT_MONITOR_ENABLED: 'true',
                TLS_CERT_EXPIRY_ALERT_DAYS_TIER_1: 30,
                TLS_CERT_EXPIRY_ALERT_DAYS_TIER_2: 7,
                TLS_CERT_MONITOR_CONCURRENCY: 5,
                TLS_CERT_ALERT_WEBHOOK_URL: 'http://localhost:3000/webhook',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: CertificateCheckerService,
          useValue: {
            checkCertificatesExpiry: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TlsCertificateMonitorService>(TlsCertificateMonitorService);
    configService = module.get<ConfigService>(ConfigService);
    certChecker = module.get<CertificateCheckerService>(CertificateCheckerService);
    redis = module.get<RedisService>(RedisService);
  });

  describe('runCertificateMonitor', () => {
    it('should return early if monitoring is disabled', async () => {
      (configService.get as jest.Mock).mockImplementation((key) => {
        if (key === 'TLS_CERT_MONITOR_ENABLED') return 'false';
        return undefined;
      });

      const result = await service.runCertificateMonitor();

      expect(result.endpointsChecked).toBe(0);
      expect(result.summary).toContain('disabled');
    });

    it('should fire tier_1 alert when cert expires in 25 days (within 30-day threshold)', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 25);
      const expiryDate = futureDate.toISOString();

      const mockResult: CertificateCheckResult = {
        hostname: 'api.example.com',
        status: 'expiring_soon',
        expiryDate,
        daysRemaining: 25,
        checkedAt: new Date().toISOString(),
      };

      (certChecker.checkCertificatesExpiry as jest.Mock).mockResolvedValue([mockResult]);
      (redis.get as jest.Mock).mockResolvedValue(null); // No prior alert
      (redis.set as jest.Mock).mockResolvedValue(undefined);

      // Mock loadEndpointsConfig indirectly via fs mock
      jest.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          endpoints: [{ hostname: 'api.example.com', port: 443 }],
        }),
      );

      const result = await service.runCertificateMonitor();

      expect(result.endpointsChecked).toBe(1);
      expect(result.expiringAlerts).toHaveLength(1);
      expect(result.expiringAlerts[0].tier).toBe('tier_1');
      expect(result.expiringAlerts[0].daysRemaining).toBe(25);

      // Verify alert was recorded in Redis.
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('tls:alert:api.example.com:tier_1'),
        expect.any(String),
        expect.any(Number),
      );

      (fs.readFile as jest.SpyInstance).mockRestore();
    });

    it('should fire both tier_1 and tier_2 alerts when cert expires in 5 days', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const expiryDate = futureDate.toISOString();

      const mockResult: CertificateCheckResult = {
        hostname: 'api.example.com',
        status: 'expiring_soon',
        expiryDate,
        daysRemaining: 5,
        checkedAt: new Date().toISOString(),
      };

      (certChecker.checkCertificatesExpiry as jest.Mock).mockResolvedValue([mockResult]);
      (redis.get as jest.Mock).mockResolvedValue(null); // No prior alerts
      (redis.set as jest.Mock).mockResolvedValue(undefined);

      jest.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          endpoints: [{ hostname: 'api.example.com', port: 443 }],
        }),
      );

      const result = await service.runCertificateMonitor();

      expect(result.expiringAlerts).toHaveLength(2);
      const tier1 = result.expiringAlerts.find((a) => a.tier === 'tier_1');
      const tier2 = result.expiringAlerts.find((a) => a.tier === 'tier_2');
      expect(tier1).toBeDefined();
      expect(tier2).toBeDefined();

      (fs.readFile as jest.SpyInstance).mockRestore();
    });

    it('should not fire alert when cert expires in 90 days (above both thresholds)', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 90);
      const expiryDate = futureDate.toISOString();

      const mockResult: CertificateCheckResult = {
        hostname: 'api.example.com',
        status: 'ok',
        expiryDate,
        daysRemaining: 90,
        checkedAt: new Date().toISOString(),
      };

      (certChecker.checkCertificatesExpiry as jest.Mock).mockResolvedValue([mockResult]);
      (redis.set as jest.Mock).mockResolvedValue(undefined);

      jest.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          endpoints: [{ hostname: 'api.example.com', port: 443 }],
        }),
      );

      const result = await service.runCertificateMonitor();

      expect(result.expiringAlerts).toHaveLength(0);

      (fs.readFile as jest.SpyInstance).mockRestore();
    });

    it('should suppress re-fire of tier_1 alert on subsequent runs', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 25);
      const expiryDate = futureDate.toISOString();

      const mockResult: CertificateCheckResult = {
        hostname: 'api.example.com',
        status: 'expiring_soon',
        expiryDate,
        daysRemaining: 25,
        checkedAt: new Date().toISOString(),
      };

      (certChecker.checkCertificatesExpiry as jest.Mock).mockResolvedValue([mockResult]);
      // Simulate prior alert already fired.
      (redis.get as jest.Mock).mockResolvedValue(
        JSON.stringify({ tier: 'tier_1', firedAt: new Date().toISOString() }),
      );
      (redis.set as jest.Mock).mockResolvedValue(undefined);

      jest.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          endpoints: [{ hostname: 'api.example.com', port: 443 }],
        }),
      );

      const result = await service.runCertificateMonitor();

      // Alert should be suppressed; not included in results.
      expect(result.expiringAlerts).toHaveLength(0);

      (fs.readFile as jest.SpyInstance).mockRestore();
    });

    it('should handle unreachable endpoints', async () => {
      const mockResult: CertificateCheckResult = {
        hostname: 'unreachable.example.com',
        status: 'unreachable',
        error: 'ECONNREFUSED',
        checkedAt: new Date().toISOString(),
      };

      (certChecker.checkCertificatesExpiry as jest.Mock).mockResolvedValue([mockResult]);
      (redis.set as jest.Mock).mockResolvedValue(undefined);

      jest.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          endpoints: [{ hostname: 'unreachable.example.com', port: 443 }],
        }),
      );

      const result = await service.runCertificateMonitor();

      expect(result.unreachableEndpoints).toHaveLength(1);
      expect(result.unreachableEndpoints[0]).toBe('unreachable.example.com');
      expect(result.expiringAlerts).toHaveLength(0);

      (fs.readFile as jest.SpyInstance).mockRestore();
    });

    it('should persist snapshot to Redis', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 25);
      const expiryDate = futureDate.toISOString();

      const mockResult: CertificateCheckResult = {
        hostname: 'api.example.com',
        status: 'expiring_soon',
        expiryDate,
        daysRemaining: 25,
        checkedAt: new Date().toISOString(),
      };

      (certChecker.checkCertificatesExpiry as jest.Mock).mockResolvedValue([mockResult]);
      (redis.get as jest.Mock).mockResolvedValue(null);
      (redis.set as jest.Mock).mockResolvedValue(undefined);

      jest.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          endpoints: [{ hostname: 'api.example.com', port: 443 }],
        }),
      );

      const result = await service.runCertificateMonitor();

      // Verify snapshot was persisted.
      expect(redis.set).toHaveBeenCalledWith(
        'tls:monitor:snapshot',
        result,
        86400, // 24-hour TTL
      );

      (fs.readFile as jest.SpyInstance).mockRestore();
    });

    it('should check multiple endpoints in parallel', async () => {
      const futureDate1 = new Date();
      futureDate1.setDate(futureDate1.getDate() + 25);

      const futureDate2 = new Date();
      futureDate2.setDate(futureDate2.getDate() + 90);

      const mockResults: CertificateCheckResult[] = [
        {
          hostname: 'api.example.com',
          status: 'expiring_soon',
          expiryDate: futureDate1.toISOString(),
          daysRemaining: 25,
          checkedAt: new Date().toISOString(),
        },
        {
          hostname: 'app.example.com',
          status: 'ok',
          expiryDate: futureDate2.toISOString(),
          daysRemaining: 90,
          checkedAt: new Date().toISOString(),
        },
      ];

      (certChecker.checkCertificatesExpiry as jest.Mock).mockResolvedValue(mockResults);
      (redis.get as jest.Mock).mockResolvedValue(null);
      (redis.set as jest.Mock).mockResolvedValue(undefined);

      jest.spyOn(fs, 'readFile').mockResolvedValue(
        JSON.stringify({
          endpoints: [
            { hostname: 'api.example.com', port: 443 },
            { hostname: 'app.example.com', port: 443 },
          ],
        }),
      );

      const result = await service.runCertificateMonitor();

      expect(result.endpointsChecked).toBe(2);
      expect(result.expiringAlerts).toHaveLength(1); // Only api.example.com
      expect(certChecker.checkCertificatesExpiry).toHaveBeenCalledWith(
        ['api.example.com', 'app.example.com'],
        443,
        5,
      );

      (fs.readFile as jest.SpyInstance).mockRestore();
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return the latest snapshot from Redis', async () => {
      const mockSnapshot = {
        checkedAt: new Date().toISOString(),
        endpointsChecked: 2,
        expiringAlerts: [],
        unreachableEndpoints: [],
        summary: 'All OK',
      };

      (redis.get as jest.Mock).mockResolvedValue(mockSnapshot);

      const result = await service.getLatestSnapshot();

      expect(result).toEqual(mockSnapshot);
      expect(redis.get).toHaveBeenCalledWith('tls:monitor:snapshot');
    });

    it('should return null if no snapshot exists', async () => {
      (redis.get as jest.Mock).mockResolvedValue(null);

      const result = await service.getLatestSnapshot();

      expect(result).toBeNull();
    });
  });
});
