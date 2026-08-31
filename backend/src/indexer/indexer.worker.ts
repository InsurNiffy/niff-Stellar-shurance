import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Redis } from 'ioredis';
import { getRedisClient } from '../redis/client';
import { IndexerService } from './indexer.service';

const LOCK_KEY = 'lock:indexer:tick';
const LOCK_TTL_MS = 30_000;
const LOCK_RETRY_DELAY_MS = 500;

// Lua script for atomic lock release — only deletes if the token matches.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

@Injectable()
export class IndexerWorker implements OnModuleInit {
  private readonly logger = new Logger(IndexerWorker.name);
  private isProcessing = false;
  private redis: Redis | null = null;

  constructor(private readonly indexerService: IndexerService) {}

  onModuleInit() {
    this.logger.log('Starting Indexer Worker loop...');
    try {
      this.redis = getRedisClient();
    } catch {
      this.logger.warn('Redis unavailable — distributed lock disabled; falling back to in-process guard.');
    }
    setTimeout(() => this.runLoop(), 5000);
  }

  private runLoop() {
    this.run()
      .catch(err => this.logger.error('Fatal Indexer Loop Error', err))
      .finally(() => {
        setTimeout(() => this.runLoop(), 5000);
      });
  }

  async run() {
    if (this.isProcessing) return;

    const token = randomBytes(16).toString('hex');
    const acquired = await this.acquireLock(token);
    if (!acquired) {
      this.logger.debug('Indexer tick skipped — another instance holds the distributed lock.');
      return;
    }

    this.isProcessing = true;
    try {
      let result;
      do {
        result = await this.indexerService.processNextBatch();
        if (result.processed > 0) {
          this.logger.debug(`Processed ${result.processed} events, lag: ${result.lag} ledgers`);
        }
      } while (result.processed > 0);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Indexer Worker Error: ${error.message}`, error.stack);
    } finally {
      this.isProcessing = false;
      await this.releaseLock(token);
    }
  }

  /** Acquire the distributed lock. Returns true if the lock was obtained. */
  private async acquireLock(token: string): Promise<boolean> {
    if (!this.redis) return true;
    try {
      const result = await this.redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.warn(`Redlock acquire failed (${err}); proceeding without lock.`);
      return true;
    }
  }

  /** Release the distributed lock atomically — only if we still own it. */
  private async releaseLock(token: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, token);
    } catch (err) {
      this.logger.warn(`Redlock release failed (${err}); lock will expire via TTL.`);
    }
  }

  /** Exposed for tests. */
  getLockRetryDelayMs(): number {
    return LOCK_RETRY_DELAY_MS;
  }
}
