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

/**
 * Internal auth headers that must never be forwarded to Horizon.
 * These are stripped from any outbound request to avoid leaking API keys.
 */
const INTERNAL_AUTH_HEADERS = [
  "authorization",
  "x-api-key",
  "x-internal-token",
  "x-internal-auth",
  "cookie",
  "proxy-authorization",
];

/**
 * Subset of Horizon transaction fields exposed by the proxy.
 */
export interface HorizonTransactionSummary {
  txHash: string;
  fee: string;
  ledger: number;
  createdAt: string;
  operationType: string;
}

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

  /**
   * Proxy endpoint for filtered transaction history.
   * Forwards to Horizon with internal auth headers stripped, applies per-wallet
   * rate limiting, and returns only the public subset of transaction fields.
   */
  async getFilteredTransactions(
    account: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ records: HorizonTransactionSummary[]; next_cursor?: string }> {
    if (!STELLAR_ADDRESS_RE.test(account)) {
      throw new BadRequestException("Invalid Stellar account address");
    }

    const rateLimit = await this.checkRateLimit(account);
    if (!rateLimit.allowed) {
      const error = new ServiceUnavailableException(
        "Rate limit exceeded for this account, please retry later",
      );
      (error as ServiceErrorWithRetryAfter).retryAfter = rateLimit.retryAfterSeconds;
      throw error;
    }

    const clampedLimit = Math.min(Math.max(1, limit), 200);
    const cacheKey = `${CACHE_PREFIX}filtered:${account}:${cursor ?? "start"}:${clampedLimit}`;

    const cached = await this.redis.get<{
      records: HorizonTransactionSummary[];
      next_cursor?: string;
    }>(cacheKey);
    if (cached) {
      this.logger.debug(`Filtered cache hit for ${account}`);
      return cached;
    }

    const url = this.buildHorizonTransactionsUrl(account, cursor, clampedLimit);
    const raw = await this.fetchFromHorizonWithCircuitBreaker(url);
    const records = this.extractRecords(raw);
    const summaries = records.map((r) => this.toTransactionSummary(r));
    const nextCursor = this.extractNextCursor(raw);

    const response: { records: HorizonTransactionSummary[]; next_cursor?: string } = {
      records: summaries,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    };

    await this.redis.set(cacheKey, response, CACHE_TTL_SECONDS);

    return response;
  }

  private toTransactionSummary(record: Record<string, unknown>): HorizonTransactionSummary {
    return {
      txHash: String(record.transaction_hash ?? record.id ?? ""),
      fee: String(record.fee_charged ?? record.fee ?? "0"),
      ledger: Number(record.ledger ?? 0),
      createdAt: String(record.created_at ?? ""),
      operationType: String(record.type ?? ""),
    };
  }

  private buildHorizonTransactionsUrl(account: string, cursor?: string, limit = 20): string {
    const base = `${this.horizonUrl}/accounts/${encodeURIComponent(account)}/transactions`;
    const params = new URLSearchParams({
      limit: String(limit),
      order: "desc",
    });
    if (cursor) params.set("cursor", cursor);
    return `${base}?${params.toString()}`;
  }

  /**
   * Removes any internal auth headers from an outbound header map so that
   * API keys and internal tokens are never forwarded to Horizon.
   */
  private stripInternalAuthHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!INTERNAL_AUTH_HEADERS.includes(key.toLowerCase())) {
        sanitized[key] = value;
      }
    }
    return sanitized;
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

      const status = (err as HttpStatusError)?.statusCode;
      if (status && status >= 400 && status < 500) {
        throw new BadRequestException("Horizon rejected the request");
      }

      this.logger.error(`Horizon request failed: ${err}`);
      throw new BadGatewayException("Failed to fetch data from Horizon");
    }
  }

  private async fetchFromHorizonInternal(
    url: string,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const sanitizedHeaders = this.stripInternalAuthHeaders(headers);
    const response = await fetch(url, { headers: sanitizedHeaders });

    if (!response.ok) {
      const error = new Error(`Horizon responded with ${response.status}`) as HttpStatusError;
      error.statusCode = response.status;
      throw error;
    }

    return (await response.json()) as Record<string, unknown>;
  }

  private extractRecords(raw: Record<string, unknown>): Record<string, unknown>[] {
    const embedded = raw?._embedded as Record<string, unknown> | undefined;
    const records = embedded?.records;
    return Array.isArray(records) ? (records as Record<string, unknown>[]) : [];
  }

  private extractNextCursor(raw: Record<string, unknown>): string | undefined {
    const links = raw?._links as Record<string, unknown> | undefined;
    const next = links?.next as Record<string, unknown> | undefined;
    const href = next?.href;
    if (typeof href !== "string") return undefined;
    try {
      return new URL(href).searchParams.get("cursor") ?? undefined;
    } catch {
      return undefined;
    }
  }

  private getHorizonApiKey(): string | undefined {
    return this.config.get<string>("HORIZON_API_KEY");
  }
}
