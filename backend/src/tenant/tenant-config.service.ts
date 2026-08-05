import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getNetworkConfig } from '../config/network.config';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

export interface TenantConfig {
  tenantId: string | null;
  contractIds: {
    niffyinsure: string;
    defaultToken: string;
  };
  featureFlags: Record<string, boolean>;
  network: string;
}

@Injectable()
export class TenantConfigService {
  private readonly logger = new Logger(TenantConfigService.name);
  private readonly configCache = new Map<string | null, { config: TenantConfig; timestamp: number }>();
  private readonly cacheTtlMs = 60_000;

  constructor(
    private readonly configService: ConfigService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  async getConfig(tenantId: string | null): Promise<TenantConfig> {
    const cached = this.configCache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      this.logger.debug(`Returning cached config for tenant: ${tenantId ?? 'default'}`);
      return cached.config;
    }

    const networkConfig = getNetworkConfig();
    const config: TenantConfig = {
      tenantId,
      contractIds: {
        niffyinsure: networkConfig.contractIds.niffyinsure,
        defaultToken: networkConfig.contractIds.defaultToken,
      },
      featureFlags: this.featureFlagsService.getFlags(),
      network: networkConfig.network,
    };

    this.configCache.set(tenantId, { config, timestamp: Date.now() });
    return config;
  }
}
