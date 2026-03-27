import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantMiddleware } from './tenant.middleware';

/**
 * TenantModule
 *
 * Provides:
 *   - TenantContextService (REQUEST-scoped) — holds the resolved tenantId
 *   - TenantMiddleware — resolves tenant from header / subdomain
 *
 * Import this module in AppModule. The middleware is applied globally.
 * TenantContextService is exported so any module can inject it.
 */
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
