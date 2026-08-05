import {
  Injectable,
  Logger,
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import CircuitBreaker from "opossum";
import { getNetworkConfig } from "../config/network.config";
import { filterHorizonOperations } from "./filters/horizon-field.filter";
import { HorizonTransactionResponse, DecodedEvent } from "./dto/horizon-transaction.dto";
import { RedisService } from "../cache/redis.service";
import { PrismaService } from "../prisma/prisma.service";

const CACHE_TTL_SECONDS = 15;
const CACHE_PREFIX = "horizon:txcache:";
const ACCOUNT_CACHE_PREFIX = "horizon:account:";
const LEDGER_CACHE_PREFIX = "horizon:ledger:";
const RL_KEY_PREFIX = "horizon:rl:";
const RL_WINDOW_MS = 60_000;
const RL_MAX_REQUESTS = 30;
const HORIZON_CIRCUIT_BREAKER_THRESHOLD = 5;
const HORIZON_CIRCUIT_BREAKER_RESET_MS = 60_000;

type HttpStatusError = Error & { statusCode?: number };
type ServiceErrorWithRetryAfter = ServiceUnavailableException & { retryAfter?: number };

/**
 * Stellar address format: 56 uppercase alphanumeric characters starting with G.
 */
const STELLAR_ADDRESS_RE = /^G[A-Z0-9]{55}$/;

@Injectable()
export class HorizonService {
  private readonly logger = new Logger(HorizonService.name);
  private readonly horizonUrl: string;
  private readonly horizonFallbackUrl: string | undefined;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerResetMs: number;
  private circuitBreaker!: CircuitBreaker;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {
    const networkConfig = getNetworkConfig();
    this.horizonUrl = networkConfig.horizonUrl;
    this.horizonFallbackUrl = networkConfig.horizonFallbackUrl;
    this.maxRequests = this.config.get<number>("HORIZON_RATE_LIMIT_MAX", RL_MAX_REQUESTS);
    this.windowMs = this.config.get<number>("HORIZON_RATE_LIMIT_WINDOW_MS", RL_WINDOW_MS);
    this.circuitBreakerThreshold = this.config.get<number>(
      "HORIZON_CIRCUIT_BREAKER_THRESHOLD",
      HORIZON_CIRCUIT_BREAKER_THRESHOLD,
    );
    this.circuitBreakerResetMs = this.config.get<number>(
      "HORIZON_CIRCUIT_BREAKER_RESET_MS",
      HORIZON_CIRCUIT_BREAKER_RESET_MS,
    );
    this.initCircuitBreaker();
  }

  private initCircuitBreaker(): void {
    this.circuitBreaker = new CircuitBreaker(
      async (url: string, headers: Record<string, string>) =>
        this.fetchFromHorizonInternal(url, headers),
      {
        timeout: 10_000,
        maxFailures: this.circuitBreakerThreshold,
        resetTimeout: this.circuitBreakerResetMs,
        name: "HorizonAPICircuitBreaker",
      },
    );

    this.circuitBreaker.on("open", () => {
      this.logger.warn("Horizon circuit breaker opened due to consecutive failures");
    });

    this.circuitBreaker.on("halfOpen", () => {
      this.logger.debug("Horizon circuit breaker transitioning to half-open state");
    });

    this.circuitBreaker.on("close", () => {
      this.logger.debug("Horizon circuit breaker closed, resuming normal operations");
    });
  }

  async checkRateLimit(account: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const key = `${RL_KEY_PREFIX}${account}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const member = `${now}-${Math.random()}`;

    try {
      const client = this.redis.getClient();
      const pipeline = client.multi();
      pipeline.zremrangebyscore(key, "-inf", String(windowStart));
      pipeline.zcard(key);
      pipeline.zadd(key, now, member);
      pipeline.expire(key, Math.ceil(this.windowMs / 1000));
      const results = await pipeline.exec();
      const count = (results?.[1]?.[1] as number) ?? 0;

      if (count >= this.maxRequests) {
        const oldest = await client.zrange(key, 0, 0, "WITHSCORES");
        const oldestTs = oldest?.[1] ? Number(oldest[1]) : now;
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + this.windowMs - now) / 1000));
        return { allowed: false, retryAfterSeconds };
      }

      return { allowed: true, retryAfterSeconds: 0 };
    } catch (err) {
      this.logger.warn(`Rate limit check failed for ${account}: ${err}`);
      return { allowed: true, retryAfterSeconds: 0 };
    }
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

    const cached = await this.redis.get<HorizonTransactionResponse>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${account}`);
      return cached;
    }

    const url = this.buildHorizonUrl(account, cursor, clampedLimit);
    const raw = await this.fetchFromHorizonWithCircuitBreaker(url);
    const records = this.extractRecords(raw);
    const filtered = filterHorizonOperations(records);
    const nextCursor = this.extractNextCursor(raw);

    // Enrich with contract events from raw_events
    let eventsEnriched = true;
    try {
      const txHashes = filtered
        .map((r) => r.transaction_hash)
        .filter(Boolean);

      if (txHashes.length > 0) {
        const events = await this.prisma.rawEvent.findMany({
          where: { txHash: { in: txHashes } },
          orderBy: [{ txHash: 'asc' }, { eventIndex: 'asc' }],
        });

        const byHash = new Map<string, DecodedEvent[]>();
        for (const e of events) {
          const decoded: DecodedEvent = {
            eventIndex: e.eventIndex,
            contractId: e.contractId,
            ledger: e.ledger,
            ledgerClosedAt: e.ledgerClosedAt.toISOString(),
            topic1: e.topic1 ?? undefined,
            topic2: e.topic2 ?? undefined,
            topic3: e.topic3 ?? undefined,
            topic4: e.topic4 ?? undefined,
            data: e.data,
          };
          const arr = byHash.get(e.txHash) ?? [];
          arr.push(decoded);
          byHash.set(e.txHash, arr);
        }

        for (const record of filtered) {
          record.contractEvents = byHash.get(record.transaction_hash) ?? [];
        }
      }
    } catch (err) {
      this.logger.warn(`Event enrichment failed: ${err}`);
      eventsEnriched = false;
    }

    const response: HorizonTransactionResponse = {
      records: filtered,
      eventsEnriched,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    };

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

  private async fetchFromHorizonWithCircuitBreaker(url: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(this.getHorizonApiKey()
        ? { Authorization: `Bearer ${this.getHorizonApiKey()}` }
        : {}),
    };

    try {
      return (await this.circuitBreaker.fire(url, headers)) as Record<string, unknown>;
    } catch (err) {
      if (this.circuitBreaker.opened) {
        const retryAfterSeconds = Math.ceil(this.circuitBreakerResetMs / 1000);
        const error = new ServiceUnavailableException("Horizon is temporarily unavailable");
        (error as ServiceErrorWithRetryAfter).retryAfter = retryAfterSeconds;
        throw error;
      }

      this.logger.error(`Horizon fetch failed: ${err}`);
      throw new BadGatewayException("Horizon is unreachable");
    }
  }

  private async fetchFromHorizonInternal(
    url: string,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const error = new Error(`Horizon returned HTTP ${res.status}`) as HttpStatusError;
        error.statusCode = res.status;
        throw error;
      }

      const data = (await res.json()) as Record<string, unknown>;
      this.logger.debug(`Horizon request succeeded from ${new URL(url).hostname}`);
      return data;
    } catch (err) {
      const statusCode = (err as HttpStatusError).statusCode;
      if (statusCode === 429) {
        const error = new Error("Too Many Requests from Horizon") as HttpStatusError;
        error.statusCode = 429;
        throw error;
      }

      const primaryHostname = new URL(url).hostname;
      if (this.horizonFallbackUrl && !url.includes(new URL(this.horizonFallbackUrl).hostname)) {
        this.logger.warn(
          `Primary Horizon (${primaryHostname}) failed, attempting fallback: ${err}`,
        );
        try {
          const fallbackUrl = url.replace(
            new URL(this.horizonUrl).hostname,
            new URL(this.horizonFallbackUrl).hostname,
          );
          const fallbackRes = await fetch(fallbackUrl, {
            headers,
            signal: AbortSignal.timeout(10_000),
          });

          if (!fallbackRes.ok) {
            const fallbackError = new Error(
              `Fallback Horizon returned HTTP ${fallbackRes.status}`,
            ) as HttpStatusError;
            fallbackError.statusCode = fallbackRes.status;
            throw fallbackError;
          }

          const data = (await fallbackRes.json()) as Record<string, unknown>;
          this.logger.log(`Horizon request succeeded from fallback endpoint`);
          return data;
        } catch (fallbackErr) {
          this.logger.error(`Both primary and fallback Horizon endpoints failed: ${fallbackErr}`);
          throw fallbackErr;
        }
      }

      throw err;
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

  private async fetchWithSingleFlightLock(
    cacheKey: string,
    fn: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const client = this.redis.getClient();
    const lockKey = `lock:${cacheKey}`;
    const lockTtl = 30;

    try {
      const lockAcquired = (await client.set(lockKey, '1', 'EX', lockTtl, 'NX')) === 'OK';

      if (lockAcquired) {
        try {
          const data = await fn();
          await this.redis.set(cacheKey, data, CACHE_TTL_SECONDS);
          return data;
        } finally {
          await client.del(lockKey).catch(() => {
            // Ignore lock release errors
          });
        }
      } else {
        const maxWaitMs = 5000;
        const pollIntervalMs = 50;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
          const cached = await this.redis.get<Record<string, unknown>>(cacheKey);
          if (cached) {
            this.logger.debug(`Single-flight lock: obtained result from cache`);
            return cached;
          }

          const lockExists = await client.exists(lockKey);
          if (lockExists === 0) {
            this.logger.debug(`Single-flight lock: holder released, checking cache`);
            const retryData = await this.redis.get<Record<string, unknown>>(cacheKey);
            if (retryData) {
              return retryData;
            }
            const data = await fn();
            await this.redis.set(cacheKey, data, CACHE_TTL_SECONDS);
            return data;
          }

          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        this.logger.warn(`Single-flight lock timeout for ${cacheKey}, computing anyway`);
        const data = await fn();
        await this.redis.set(cacheKey, data, CACHE_TTL_SECONDS);
        return data;
      }
    } catch (err) {
      this.logger.warn(`Single-flight lock failed, degrading to unprotected: ${err}`);
      return await fn();
    }
  }

  async getAccount(account: string): Promise<Record<string, unknown>> {
    if (!STELLAR_ADDRESS_RE.test(account)) {
      throw new BadRequestException("Invalid Stellar account address");
    }

    const cacheKey = `${ACCOUNT_CACHE_PREFIX}${account}`;
    const cached = await this.redis.get<Record<string, unknown>>(cacheKey);
    if (cached) {
      this.logger.debug(`Account cache hit for ${account}`);
      return cached;
    }

    return await this.fetchWithSingleFlightLock(cacheKey, () => {
      const url = `${this.horizonUrl}/accounts/${encodeURIComponent(account)}`;
      return this.fetchFromHorizonWithCircuitBreaker(url);
    });
  }

  async getLedger(ledgerSequence: number): Promise<Record<string, unknown>> {
    if (!Number.isInteger(ledgerSequence) || ledgerSequence < 0) {
      throw new BadRequestException("Ledger sequence must be a non-negative integer");
    }

    const cacheKey = `${LEDGER_CACHE_PREFIX}${ledgerSequence}`;
    const cached = await this.redis.get<Record<string, unknown>>(cacheKey);
    if (cached) {
      this.logger.debug(`Ledger cache hit for sequence ${ledgerSequence}`);
      return cached;
    }

    return await this.fetchWithSingleFlightLock(cacheKey, () => {
      const url = `${this.horizonUrl}/ledgers/${ledgerSequence}`;
      return this.fetchFromHorizonWithCircuitBreaker(url);
    });
  }
}
