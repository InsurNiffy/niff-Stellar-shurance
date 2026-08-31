import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TenantContextService } from './tenant-context.service';
import { TenantConfigService, TenantConfig } from './tenant-config.service';
import { TenantOnboardingService, OnboardingChecklist } from './tenant-onboarding.service';

@ApiTags('Tenant')
@Controller('tenant')
export class TenantController {
  constructor(
    private readonly tenantContextService: TenantContextService,
    private readonly tenantConfigService: TenantConfigService,
    private readonly tenantOnboardingService: TenantOnboardingService,
  ) {}

  @Get('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get tenant configuration (contract IDs, feature flags)' })
  @ApiResponse({
    status: 200,
    description: 'Tenant configuration including contract IDs, feature flags, and network.',
    schema: {
      example: {
        tenantId: 'acme',
        contractIds: {
          niffyinsure: 'CCXZ...',
          defaultToken: 'CBDR...',
        },
        featureFlags: {
          claims_enabled: true,
          policy_creation_enabled: true,
        },
        network: 'testnet',
      },
    },
  })
  async getConfig(): Promise<TenantConfig> {
    const tenantId = this.tenantContextService.tenantId;
    return this.tenantConfigService.getConfig(tenantId);
  }

  @Get('onboarding-checklist')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get tenant onboarding setup completeness' })
  @ApiResponse({
    status: 200,
    description: 'Onboarding checklist showing which setup steps are complete.',
    schema: {
      example: {
        tenantId: 'acme',
        completedSteps: 3,
        totalSteps: 4,
        isComplete: false,
        steps: [
          {
            id: 'contract_niffyinsure',
            name: 'Niffo Insurance Contract',
            description: 'Niffo insurance contract ID configured',
            completed: true,
          },
          {
            id: 'contract_default_token',
            name: 'Default Token Contract',
            description: 'Default token contract ID configured',
            completed: false,
          },
        ],
      },
    },
  })
  async getOnboardingChecklist(): Promise<OnboardingChecklist> {
    const tenantId = this.tenantContextService.tenantId;
    return this.tenantOnboardingService.getOnboardingChecklist(tenantId);
  }
}
