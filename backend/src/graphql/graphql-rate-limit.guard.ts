import { CanActivate, ExecutionContext, Injectable, Logger, TooManyRequestsException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthIdentityService } from '../auth/auth-identity.service';
import { RedisService } from '../cache/redis.service';
import type { GraphqlContext } from './graphql.context';

@Injectable()
export class GraphqlRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(GraphqlRateLimitGuard.name);
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly authIdentity: AuthIdentityService,
  ) {
    this.limit = this.config.get<number>('GRAPHQL_RATE_LIMIT_MAX', 60);
    this.windowMs = this.config.get<number>('GRAPHQL_RATE_LIMIT_WINDOW_MS', 60_000);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlContext = GqlExecutionContext.create(context).getContext<GraphqlContext>();
    const request = gqlContext.req;
    const identity = await this.authIdentity.resolveRequestIdentity(request);
    const key = this.buildKey(identity, request.ip ?? request.socket?.remoteAddress ?? 'anonymous');
    const windowBucket = Math.floor(Date.now() / this.windowMs);
    const redisKey = `graphql:rate-limit:${key}:${windowBucket}`;

    try {
      const client = this.redis.getClient();
      const count = await client.incr(redisKey);
      if (count === 1) {
        await client.pexpire(redisKey, this.windowMs);
      }

      if (count > this.limit) {
        throw new TooManyRequestsException('GraphQL operation rate limit exceeded');
      }
    } catch (error) {
      if (error instanceof TooManyRequestsException) {
        throw error;
      }

      this.logger.warn(`GraphQL rate-limit check failed open: ${String(error)}`);
    }

    return true;
  }

  private buildKey(
    identity: Awaited<ReturnType<AuthIdentityService['resolveRequestIdentity']>>,
    fallback: string,
  ): string {
    if (!identity) {
      return `ip:${fallback}`;
    }

    if (identity.kind === 'wallet') {
      return `wallet:${identity.walletAddress}`;
    }

    return `staff:${identity.role}:${identity.staffId}`;
  }
}
