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
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('GRAPHQL_PERSISTED_QUERIES_ENABLED', false);
    this.ttlSeconds = config.get<number>('GRAPHQL_PERSISTED_QUERY_TTL_SECONDS', 86_400);
  }

  async use(req: PersistedQueryRequest, res: Response, next: NextFunction): Promise<void> {
    const persistedQuery = req.body?.extensions?.persistedQuery;
    if (!persistedQuery?.sha256Hash) {
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
