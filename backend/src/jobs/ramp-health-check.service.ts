import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface RampHealthCheckResult {
  status: 'up' | 'degraded' | 'down';
  checkedAt: Date;
  errorMessage?: string;
}

@Injectable()
export class RampHealthCheckService {
  private readonly logger = new Logger(RampHealthCheckService.name);
  private lastStatus: RampHealthCheckResult | null = null;
  private lastKnownStatus: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  getLastStatus(): RampHealthCheckResult | null {
    return this.lastStatus;
  }

  /**
   * Runs every 5 minutes. Pings the ramp provider's health endpoint
   * and tracks status transitions.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkProviderHealth(): Promise<RampHealthCheckResult> {
    this.logger.log('Checking ramp provider health...');

    const rampHealthUrl = this.config.get<string>('RAMP_HEALTH_URL');
    if (!rampHealthUrl) {
      this.logger.warn('RAMP_HEALTH_URL not configured — skipping ramp health check');
      const result: RampHealthCheckResult = {
        status: 'down',
        checkedAt: new Date(),
        errorMessage: 'RAMP_HEALTH_URL not configured',
      };
      this.lastStatus = result;
      return result;
    }

    let status: 'up' | 'degraded' | 'down' = 'down';
    let errorMessage: string | undefined;

    try {
      const response = await this.pingRampProvider(rampHealthUrl);
      status = response.status as 'up' | 'degraded' | 'down';
      errorMessage = response.errorMessage;

      // Emit metric on state transition
      if (this.lastKnownStatus !== status) {
        this.logger.warn(
          `Ramp provider status transition: ${this.lastKnownStatus || 'unknown'} → ${status}`,
        );
        this.lastKnownStatus = status;
      }
    } catch (err) {
      status = 'down';
      errorMessage = String(err);
      this.logger.error(`Ramp provider health check failed: ${err}`);

      // Emit state transition
      if (this.lastKnownStatus !== 'down') {
        this.logger.warn(`Ramp provider status transition: ${this.lastKnownStatus || 'unknown'} → down`);
        this.lastKnownStatus = 'down';
      }
    }

    const result: RampHealthCheckResult = {
      status,
      checkedAt: new Date(),
      errorMessage,
    };

    this.lastStatus = result;

    // Persist health status to database for exposure via health endpoint
    await this.prisma.rampProviderHealth.create({
      data: {
        status,
        lastCheckedAt: new Date(),
        errorMessage,
      },
    });

    return result;
  }

  private async pingRampProvider(_healthUrl: string): Promise<{ status: string; errorMessage?: string }> {
    // Placeholder for actual HTTP health check to Ramp provider
    // In production, this would make an HTTP request to the provider's health endpoint
    // and parse the response to determine status (up, degraded, down)
    return { status: 'up' };
  }
}
