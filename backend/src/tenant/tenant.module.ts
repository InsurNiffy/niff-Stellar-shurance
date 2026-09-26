import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantMiddleware } from './tenant.middleware';
import { TenantConfigService } from './tenant-config.service';
import { TenantOnboardingService } from './tenant-onboarding.service';
import { TenantController } from './tenant.controller';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';

/**
 * TenantModule
 *
 * Provides:
 *   - TenantContextService (REQUEST-scoped) — holds the resolved tenantId
 *   - TenantConfigService — returns per-tenant configuration (cached)
 *   - TenantConfigAuditService — logs and retrieves tenant config change audit trail
 *   - TenantController — exposes GET /tenant/config endpoint
 *   - TenantMiddleware — resolves tenant from header / subdomain
 *
 * Configuration response includes:
 *   - tenantId: resolved tenant ID or null for single-tenant mode
 *   - contractIds: niffyinsure and defaultToken contract addresses
 *   - featureFlags: map of enabled/disabled features
 *   - network: active Stellar network (testnet/mainnet/futurenet)
 *
 * Cache TTL: 60 seconds (FEATURE_FLAG_CACHE_TTL_MS). Refresh required for
 * feature flag changes to propagate to frontends.
 *
 * Import this module in AppModule. The middleware is applied globally.
 * TenantContextService, TenantConfigService, and TenantConfigAuditService are exported for injection.
 */
@Module({
  imports: [FeatureFlagsModule],
  providers: [TenantContextService, TenantConfigService, TenantOnboardingService],
  controllers: [TenantController],
  exports: [TenantContextService, TenantConfigService, TenantOnboardingService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
