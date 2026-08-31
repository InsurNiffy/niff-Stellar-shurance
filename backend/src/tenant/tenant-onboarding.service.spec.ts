import { Test, TestingModule } from '@nestjs/testing';
import { TenantOnboardingService } from './tenant-onboarding.service';
import { TenantConfigService } from './tenant-config.service';

describe('TenantOnboardingService', () => {
  let service: TenantOnboardingService;
  let tenantConfigService: TenantConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantOnboardingService,
        {
          provide: TenantConfigService,
          useValue: {
            getConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TenantOnboardingService>(TenantOnboardingService);
    tenantConfigService = module.get<TenantConfigService>(TenantConfigService);
  });

  describe('getOnboardingChecklist', () => {
    it('should return all steps complete for a fully configured tenant', async () => {
      jest.spyOn(tenantConfigService, 'getConfig').mockResolvedValue({
        tenantId: 'acme',
        contractIds: {
          niffyinsure: 'CBDR3BJNQ5XVSXZ7A7PXYEWVW5D5EJHTYV34YOWWWTYPV7NEWED3XUH',
          defaultToken: 'CCXZ3XVCDTUJ76ZAV2HA72KYEELTJE322P3HYHBNHY56PSFPSQYOPA',
        },
        featureFlags: {
          claims_enabled: true,
          policy_creation_enabled: true,
        },
        network: 'testnet',
      });

      const result = await service.getOnboardingChecklist('acme');

      expect(result.tenantId).toBe('acme');
      expect(result.completedSteps).toBe(4);
      expect(result.totalSteps).toBe(4);
      expect(result.isComplete).toBe(true);
      expect(result.steps.every((s) => s.completed)).toBe(true);
    });

    it('should return incomplete steps for a partially configured tenant', async () => {
      jest.spyOn(tenantConfigService, 'getConfig').mockResolvedValue({
        tenantId: 'partial-tenant',
        contractIds: {
          niffyinsure: 'CBDR3BJNQ5XVSXZ7A7PXYEWVW5D5EJHTYV34YOWWWTYPV7NEWED3XUH',
          defaultToken: '', // Missing
        },
        featureFlags: {}, // No feature flags
        network: 'testnet',
      });

      const result = await service.getOnboardingChecklist('partial-tenant');

      expect(result.tenantId).toBe('partial-tenant');
      expect(result.completedSteps).toBe(2);
      expect(result.totalSteps).toBe(4);
      expect(result.isComplete).toBe(false);

      const incompleteSteps = result.steps.filter((s) => !s.completed);
      expect(incompleteSteps).toContainEqual(
        expect.objectContaining({ id: 'contract_default_token', completed: false }),
      );
      expect(incompleteSteps).toContainEqual(
        expect.objectContaining({ id: 'feature_flags_configured', completed: false }),
      );
    });

    it('should return all steps incomplete for a newly created tenant', async () => {
      jest.spyOn(tenantConfigService, 'getConfig').mockResolvedValue({
        tenantId: 'new-tenant',
        contractIds: {
          niffyinsure: '',
          defaultToken: '',
        },
        featureFlags: {},
        network: '',
      });

      const result = await service.getOnboardingChecklist('new-tenant');

      expect(result.tenantId).toBe('new-tenant');
      expect(result.completedSteps).toBe(0);
      expect(result.totalSteps).toBe(4);
      expect(result.isComplete).toBe(false);
      expect(result.steps.every((s) => !s.completed)).toBe(true);
    });

    it('should include correct step metadata', async () => {
      jest.spyOn(tenantConfigService, 'getConfig').mockResolvedValue({
        tenantId: 'test',
        contractIds: {
          niffyinsure: 'CONTRACT',
          defaultToken: 'TOKEN',
        },
        featureFlags: {
          enabled: true,
        },
        network: 'testnet',
      });

      const result = await service.getOnboardingChecklist('test');

      expect(result.steps).toContainEqual(
        expect.objectContaining({
          id: 'contract_niffyinsure',
          name: 'Niffo Insurance Contract',
          completed: true,
        }),
      );
      expect(result.steps).toContainEqual(
        expect.objectContaining({
          id: 'network_configured',
          name: 'Network Configuration',
          completed: true,
        }),
      );
    });
  });
});
