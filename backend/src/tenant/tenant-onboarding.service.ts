import { Injectable, Logger } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';

export interface OnboardingStep {
  id: string;
  name: string;
  description: string;
  completed: boolean;
}

export interface OnboardingChecklist {
  tenantId: string | null;
  completedSteps: number;
  totalSteps: number;
  isComplete: boolean;
  steps: OnboardingStep[];
}

@Injectable()
export class TenantOnboardingService {
  private readonly logger = new Logger(TenantOnboardingService.name);

  constructor(private readonly tenantConfigService: TenantConfigService) {}

  async getOnboardingChecklist(tenantId: string | null): Promise<OnboardingChecklist> {
    const config = await this.tenantConfigService.getConfig(tenantId);

    const steps: OnboardingStep[] = [
      {
        id: 'contract_niffyinsure',
        name: 'Niffo Insurance Contract',
        description: 'Niffo insurance contract ID configured',
        completed: !!config.contractIds.niffyinsure,
      },
      {
        id: 'contract_default_token',
        name: 'Default Token Contract',
        description: 'Default token contract ID configured',
        completed: !!config.contractIds.defaultToken,
      },
      {
        id: 'network_configured',
        name: 'Network Configuration',
        description: 'Stellar network selected and configured',
        completed: !!config.network,
      },
      {
        id: 'feature_flags_configured',
        name: 'Feature Flags',
        description: 'Feature flags initialized',
        completed: Object.keys(config.featureFlags).length > 0,
      },
    ];

    const completedSteps = steps.filter((s) => s.completed).length;
    const totalSteps = steps.length;

    return {
      tenantId,
      completedSteps,
      totalSteps,
      isComplete: completedSteps === totalSteps,
      steps,
    };
  }
}
