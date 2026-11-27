import { Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service';
import { CardinalityGuardService } from './cardinality-guard.service';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      controller: MetricsController,
    }),
  ],
  controllers: [MetricsController],
  providers: [MetricsService, CardinalityGuardService],
  exports: [MetricsService, CardinalityGuardService],
})
export class MetricsModule {}
