import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { checkRedisHealth } from '../redis/client';

/**
 * Redis health indicator for /health endpoint.
 *
 * Returns:
 *   - "up" if Redis responds to PING within 2 s
 *   - "down" if Redis is unreachable or times out
 *
 * Kubernetes readiness/liveness probes should tolerate Redis being down
 * (the app degrades gracefully), but operators should alert on prolonged
 * Redis unavailability to restore cache and rate-limiting functionality.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isUp = await checkRedisHealth();
    const result = this.getStatus(key, isUp);

    if (isUp) {
      return result;
    }

    throw new HealthCheckError('Redis health check failed', result);
  }
}
