import {
  Controller,
  Get,
  Headers,
  Ip,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Exposes GET /metrics for Prometheus scraping.
 * Excluded from Swagger docs — this is an ops endpoint, not a public API.
 *
 * Access is restricted to an IP allowlist and/or a bearer token so the
 * endpoint is never exposed to the public internet.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  private readonly allowedIps: string[];
  private readonly bearerToken?: string;

  constructor(private readonly metricsService: MetricsService) {
    this.allowedIps = (process.env.METRICS_ALLOWED_IPS ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0);
    this.bearerToken = process.env.METRICS_BEARER_TOKEN || undefined;
  }

  @Get()
  async scrape(
    @Ip() ip: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    this.assertAuthorized(ip, authorization);

    const [metrics, contentType] = await Promise.all([
      this.metricsService.getMetrics(),
      Promise.resolve(this.metricsService.getContentType()),
    ]);
    res.set('Content-Type', contentType);
    res.end(metrics);
  }

  /**
   * Allow the request when the caller IP is on the allowlist OR a valid
   * bearer token is presented. If neither control is configured the endpoint
   * is treated as locked down (deny by default).
   */
  private assertAuthorized(ip: string, authorization?: string): void {
    const ipAllowed =
      this.allowedIps.length > 0 && this.allowedIps.includes(ip);
    const tokenAllowed =
      !!this.bearerToken &&
      authorization === `Bearer ${this.bearerToken}`;

    if (!ipAllowed && !tokenAllowed) {
      throw new UnauthorizedException('Metrics endpoint access denied');
    }
  }
}
