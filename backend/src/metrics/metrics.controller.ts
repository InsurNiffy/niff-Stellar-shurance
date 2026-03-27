import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Exposes GET /metrics for Prometheus scraping.
 * Excluded from Swagger docs — this is an ops endpoint, not a public API.
 *
 * Restrict access at the network/ingress level (not exposed to the public internet).
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    const [metrics, contentType] = await Promise.all([
      this.metricsService.getMetrics(),
      Promise.resolve(this.metricsService.getContentType()),
    ]);
    res.set('Content-Type', contentType);
    res.end(metrics);
  }
}
