import {
  Injectable,
  Logger,
  BadGatewayException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getNetworkConfig } from "../config/network.config";
import { filterHorizonOperations } from "./filters/horizon-field.filter";
import { HorizonTransactionResponse } from "./dto/horizon-transaction.dto";
import { RedisService } from "../cache/redis.service";
import { HorizonRateLimitService } from "../horizon-rate-limit.service";

const CACHE_TTL_SECONDS = 15;
const CACHE_PREFIX = "horizon:txcache:";

/**
 * Stellar address format: 56 uppercase alphanumeric characters starting with G.
 */
const STELLAR_ADDRESS_RE = /^G[A-Z0-9]{55}$/;

@Injectable()
export class HorizonService {
  private readonly logger = new Logger(HorizonService.name);
  private readonly horizonUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly rateLimitService: HorizonRateLimitService,
  ) {
    // Resolve from network config (supports per-network overrides)
    const networkConfig = getNetworkConfig();
    this.horizonUrl = networkConfig.horizonUrl;
  }

  async getTransactions(
    account: string,
    cursor?: string,
    limit = 20,
  ): Promise<HorizonTransactionResponse> {
    if (!STELLAR_ADDRESS_RE.test(account)) {
      throw new BadRequestException("Invalid Stellar account address");
    }

    const clampedLimit = Math.min(Math.max(1, limit), 200);
    const cacheKey = `${CACHE_PREFIX}${account}:${cursor ?? "start"}:${clampedLimit}`;

    // Check short-lived cache — do not cache beyond 15 s (finality lag window)
    const cached = await this.redis.get<HorizonTransactionResponse>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${account}`);
      return cached;
    }

    const url = this.buildHorizonUrl(account, cursor, clampedLimit);
    const raw = await this.fetchFromHorizon(url);
    const records = this.extractRecords(raw);
    const filtered = filterHorizonOperations(records);
    const nextCursor = this.extractNextCursor(raw);

    const response: HorizonTransactionResponse = {
      records: filtered,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    };

    // Cache filtered response — never the raw Horizon payload
    await this.redis.set(cacheKey, response, CACHE_TTL_SECONDS);

    return response;
  }

  private buildHorizonUrl(account: string, cursor?: string, limit = 20): string {
    const base = `${this.horizonUrl}/accounts/${encodeURIComponent(account)}/operations`;
    const params = new URLSearchParams({
      limit: String(limit),
      order: "desc",
    });
    if (cursor) params.set("cursor", cursor);
    return `${base}?${params.toString()}`;
  }

  private async fetchFromHorizon(url: string): Promise<Record<string, unknown>> {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        // Never forward client-supplied headers here — Horizon API keys
        // are injected server-side only if HORIZON_API_KEY is set.
        ...(this.getHorizonApiKey()
          ? { Authorization: `Bearer ${this.getHorizonApiKey()}` }
          : {}),
      };

      // Use rate limiting service for Horizon API calls
      const response = await this.rateLimitService.executeWithRateLimit<Record<string, unknown>>(
        url,
        {
          headers,
          signal: AbortSignal.timeout(10_000),
        },
        'horizon-api'
      );

      this.logger.debug(`Horizon request successful: ${url}`);
      return response;
    } catch (err) {
      this.logger.error(`Horizon fetch failed: ${err}`);
      
      // Handle rate limit specific errors
      if (err instanceof Error) {
        if (err.message.includes('queue is full')) {
          throw new BadGatewayException("Horizon rate limit queue is full - please try again later");
        }
        if (err.message.includes('timed out')) {
          throw new BadGatewayException("Horizon request timed out");
        }
      }
      
      throw new BadGatewayException("Horizon is unreachable");
    }
  }

  private getHorizonApiKey(): string | undefined {
    return this.config.get<string>("HORIZON_API_KEY") ?? undefined;
  }

  private extractRecords(raw: Record<string, unknown>): Record<string, unknown>[] {
    try {
      const embedded = raw["_embedded"] as Record<string, unknown> | undefined;
      const records = embedded?.["records"];
      if (!Array.isArray(records)) return [];
      return records as Record<string, unknown>[];
    } catch {
      return [];
    }
  }

  private extractNextCursor(raw: Record<string, unknown>): string | undefined {
    try {
      const links = raw["_links"] as Record<string, unknown> | undefined;
      const next = links?.["next"] as Record<string, unknown> | undefined;
      const href = next?.["href"] as string | undefined;
      if (!href) return undefined;
      const url = new URL(href);
      return url.searchParams.get("cursor") ?? undefined;
    } catch {
      return undefined;
    }
  }
}
