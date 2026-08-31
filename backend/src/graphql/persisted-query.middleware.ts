import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RedisService } from '../cache/redis.service';

/** Allowlist entry: either a raw query string or an object carrying the query plus an optional per-operation complexity budget. */
export type AllowlistEntry = string | { query: string; maxComplexity?: number };

type PersistedQueryRequest = Request & {
  body?: {
    query?: string;
    extensions?: {
      persistedQuery?: {
        sha256Hash?: string;
        version?: number;
      };
    };
  };
  /** Populated when the matched allowlist entry carries a per-operation budget. */
  persistedQueryMaxComplexity?: number;
};

@Injectable()
export class PersistedQueryMiddleware implements NestMiddleware {
  private readonly enabled: boolean;
  private readonly required: boolean;
  private readonly registrationEnabled: boolean;
  private readonly persistedQueriesOnly: boolean;
  private readonly allowlistHashes: Set<string>;
  private readonly allowlistBodies: Map<string, string>;
  /** Per-operation complexity budgets keyed by hash. Absent means use global limit. */
  private readonly allowlistBudgets: Map<string, number>;
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    this.enabled = config.get<boolean>('GRAPHQL_PERSISTED_QUERIES_ENABLED', false);
    this.required = config.get<boolean>('GRAPHQL_PERSISTED_QUERIES_REQUIRED', isProduction);
    this.registrationEnabled = config.get<boolean>(
      'GRAPHQL_PERSISTED_QUERY_REGISTRATION_ENABLED',
      !isProduction,
    );
    this.persistedQueriesOnly = config.get<boolean>(
      'GRAPHQL_PERSISTED_QUERIES_ONLY',
      isProduction,
    );
    this.ttlSeconds = config.get<number>('GRAPHQL_PERSISTED_QUERY_TTL_SECONDS', 86_400);

    const { bodies, budgets } = PersistedQueryMiddleware.loadAllowlistFile(config);
    this.allowlistBodies = bodies;
    this.allowlistBudgets = budgets;

    const envHashes = (config.get<string>('GRAPHQL_PERSISTED_QUERY_ALLOWLIST', '') ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    this.allowlistHashes = new Set([...this.allowlistBodies.keys(), ...envHashes]);
  }

  async use(req: PersistedQueryRequest, res: Response, next: NextFunction): Promise<void> {
    const persistedQuery = req.body?.extensions?.persistedQuery;
    const hash = persistedQuery?.sha256Hash;
    const query = req.body?.query;

    if (!this.persistedQueriesOnly) {
      // Development mode: no hash required, no allowlist enforcement.
      if (!hash) {
        if (this.required) {
          this.writeError(res, 'Persisted query hash is required', 'PERSISTED_QUERY_REQUIRED');
          return;
        }
        return next();
      }

      if (!this.enabled) {
        this.writeError(res, 'Persisted queries are disabled', 'PERSISTED_QUERY_DISABLED');
        return;
      }

      return this.processApq(req, res, next, hash, query, false);
    }

    // Production mode: every request must carry an allowlisted hash.
    if (!hash) {
      this.writeError(res, 'PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
      return;
    }

    if (!this.allowlistHashes.has(hash)) {
      this.writeError(res, 'PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
      return;
    }

    // Attach per-operation complexity budget before continuing so the Apollo
    // plugin can read it from the request and override the global limit.
    const budget = this.allowlistBudgets.get(hash);
    if (budget !== undefined) {
      req.persistedQueryMaxComplexity = budget;
    }

    return this.processApq(req, res, next, hash, query, true);
  }

  private async processApq(
    req: PersistedQueryRequest,
    res: Response,
    next: NextFunction,
    hash: string,
    query: string | undefined,
    useStaticFallback: boolean,
  ): Promise<void> {
    const key = `graphql:apq:${hash}`;

    if (query) {
      const actualHash = createHash('sha256').update(query).digest('hex');
      if (actualHash !== hash) {
        this.writeError(res, 'Persisted query hash mismatch', 'PERSISTED_QUERY_HASH_MISMATCH');
        return;
      }

      if (!this.registrationEnabled && !this.allowlistHashes.has(hash)) {
        this.writeError(
          res,
          'Persisted query hash is not allowlisted',
          'PERSISTED_QUERY_NOT_ALLOWLISTED',
        );
        return;
      }

      await this.redis.set(key, query, this.ttlSeconds);
      return next();
    }

    const storedQuery =
      (await this.redis.get<string>(key)) ??
      (useStaticFallback ? this.allowlistBodies.get(hash) : undefined);

    if (!storedQuery) {
      this.writeError(res, 'PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
      return;
    }

    req.body = { ...req.body, query: storedQuery };
    next();
  }

  private writeError(res: Response, message: string, code: string): void {
    res.status(400).json({
      errors: [
        {
          message,
          extensions: {
            code,
          },
        },
      ],
    });
  }

  private static loadAllowlistFile(_config: ConfigService): {
    bodies: Map<string, string>;
    budgets: Map<string, number>;
  } {
    const bodies = new Map<string, string>();
    const budgets = new Map<string, number>();
    const filePath = join(process.cwd(), 'src/graphql/persisted-query-allowlist.json');

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      return { bodies, budgets };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { bodies, budgets };
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [hash, entry] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof entry === 'string') {
          bodies.set(hash, entry);
        } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          const obj = entry as Record<string, unknown>;
          if (typeof obj.query === 'string') {
            bodies.set(hash, obj.query);
            if (typeof obj.maxComplexity === 'number' && obj.maxComplexity > 0) {
              budgets.set(hash, obj.maxComplexity);
            }
          }
        }
      }
    }

    return { bodies, budgets };
  }
}
