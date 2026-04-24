import { createHash } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RedisService } from '../cache/redis.service';

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
};

@Injectable()
export class PersistedQueryMiddleware implements NestMiddleware {
  private readonly enabled: boolean;
  private readonly required: boolean;
  private readonly registrationEnabled: boolean;
  private readonly allowlist: Set<string>;
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    const isProduction = config.get<string>('NODE_ENV') === 'production';
    this.enabled = config.get<boolean>('GRAPHQL_PERSISTED_QUERIES_ENABLED', false);
    this.required = config.get<boolean>(
      'GRAPHQL_PERSISTED_QUERIES_REQUIRED',
      isProduction,
    );
    this.registrationEnabled = config.get<boolean>(
      'GRAPHQL_PERSISTED_QUERY_REGISTRATION_ENABLED',
      !isProduction,
    );
    this.allowlist = new Set(
      (config.get<string>('GRAPHQL_PERSISTED_QUERY_ALLOWLIST', '') ?? '')
        .split(',')
        .map((hash) => hash.trim())
        .filter(Boolean),
    );
    this.ttlSeconds = config.get<number>('GRAPHQL_PERSISTED_QUERY_TTL_SECONDS', 86_400);
  }

  async use(req: PersistedQueryRequest, res: Response, next: NextFunction): Promise<void> {
    const persistedQuery = req.body?.extensions?.persistedQuery;
    if (!persistedQuery?.sha256Hash) {
      if (this.required) {
        this.writeError(
          res,
          'Persisted query hash is required',
          'PERSISTED_QUERY_REQUIRED',
        );
        return;
      }
      return next();
    }

    if (!this.enabled) {
      this.writeError(res, 'Persisted queries are disabled', 'PERSISTED_QUERY_DISABLED');
      return;
    }

    const key = `graphql:apq:${persistedQuery.sha256Hash}`;
    const query = req.body?.query;

    if (query) {
      const actualHash = createHash('sha256').update(query).digest('hex');
      if (actualHash !== persistedQuery.sha256Hash) {
        this.writeError(res, 'Persisted query hash mismatch', 'PERSISTED_QUERY_HASH_MISMATCH');
        return;
      }

      if (!this.registrationEnabled && !this.allowlist.has(persistedQuery.sha256Hash)) {
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

    const storedQuery = await this.redis.get<string>(key);
    if (!storedQuery) {
      this.writeError(res, 'PersistedQueryNotFound', 'PERSISTED_QUERY_NOT_FOUND');
      return;
    }

    req.body = {
      ...req.body,
      query: storedQuery,
    };
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
}
