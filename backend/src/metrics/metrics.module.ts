import { Module, Global, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { MetricsAuthMiddleware } from './metrics-auth.middleware';
import { MetricsCardinalityGuard } from './cardinality-guard.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsAuthMiddleware, MetricsCardinalityGuard],
  exports: [MetricsService, MetricsCardinalityGuard],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(MetricsAuthMiddleware)
      .forRoutes({ path: 'metrics', method: RequestMethod.GET });
  }
}
