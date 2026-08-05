import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantContextService } from './tenant-context.service';
import { TenantConfigService } from './tenant-config.service';
import { TenantController } from './tenant.controller';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

describe('TenantConfig - Integration Tests', () => {
  let app: INestApplication;
  let tenantContextService: TenantContextService;
  let tenantConfigService: TenantConfigService;

  beforeEach(async () => {
    const mockFeatureFlagsService = {
      getFlags: () => ({
        claims_enabled: true,
        policy_creation_enabled: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
      ],
      controllers: [TenantController],
      providers: [
        TenantContextService,
        TenantConfigService,
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
      ],
    }).compile();

    app = module.createNestApplication();
    tenantContextService = module.get<TenantContextService>(TenantContextService);
    tenantConfigService = module.get<TenantConfigService>(TenantConfigService);

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Single-tenant mode (no tenant ID)', () => {
    it('should return config for default tenant (null tenantId)', async () => {
      tenantContextService.tenantId = null;

      const config = await tenantConfigService.getConfig(null);

      expect(config).toBeDefined();
      expect(config.tenantId).toBeNull();
      expect(config.contractIds).toBeDefined();
      expect(config.contractIds.niffyinsure).toBeDefined();
      expect(config.contractIds.defaultToken).toBeDefined();
      expect(config.featureFlags).toBeDefined();
      expect(config.network).toBeDefined();
    });
  });

  describe('Multi-tenant mode', () => {
    it('should return config for specific tenant (acme)', async () => {
      const tenantId = 'acme';
      tenantContextService.tenantId = tenantId;

      const config = await tenantConfigService.getConfig(tenantId);

      expect(config).toBeDefined();
      expect(config.tenantId).toBe('acme');
      expect(config.contractIds).toBeDefined();
      expect(config.featureFlags).toBeDefined();
    });

    it('should cache config per tenant', async () => {
      const tenantId = 'acme';
      tenantContextService.tenantId = tenantId;

      const config1 = await tenantConfigService.getConfig(tenantId);
      const config2 = await tenantConfigService.getConfig(tenantId);

      expect(config1).toEqual(config2);
      expect(config1.tenantId).toBe(tenantId);
    });

    it('should return different configs for different tenants', async () => {
      const config1 = await tenantConfigService.getConfig('acme');
      const config2 = await tenantConfigService.getConfig('fabrikam');

      expect(config1.tenantId).toBe('acme');
      expect(config2.tenantId).toBe('fabrikam');
      expect(config1.contractIds).toEqual(config2.contractIds);
    });

    it('should return same config for null and undefined tenant', async () => {
      const configNull = await tenantConfigService.getConfig(null);
      const configUndefined = await tenantConfigService.getConfig(undefined as any);

      expect(configNull.tenantId).toBeNull();
      expect(configUndefined.tenantId).toBeNull();
    });
  });

  describe('Feature flags in config', () => {
    it('should include feature flags from FeatureFlagsService', async () => {
      const config = await tenantConfigService.getConfig('test');

      expect(config.featureFlags).toHaveProperty('claims_enabled');
      expect(config.featureFlags).toHaveProperty('policy_creation_enabled');
      expect(config.featureFlags.claims_enabled).toBe(true);
    });
  });

  describe('Network information', () => {
    it('should include network from NetworkConfig', async () => {
      const config = await tenantConfigService.getConfig(null);

      expect(config.network).toBeDefined();
      expect(['testnet', 'mainnet', 'futurenet']).toContain(config.network);
    });
  });
});
