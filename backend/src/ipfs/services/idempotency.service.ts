/**
 * Idempotency Service
 * 
 * Prevents duplicate uploads when the same file is uploaded multiple times
 * (e.g., due to retries, double-clicks, or network issues).
 * 
 * Uses Redis for storing request hashes and their responses.
 * The idempotency key can be provided via header or generated from file content hash.
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../cache/redis.service';
import { createHash } from 'crypto';

export interface IdempotencyRecord {
  /** The original idempotency key */
  key: string;
  /** SHA-256 hash of the file content */
  contentHash: string;
  /** The response that was returned */
  response: {
    cid: string;
    gatewayUrls: string[];
    uploadedAt: string;
  };
  /** Timestamp when the record was created */
  createdAt: string;
  /** Number of times this key was used */
  hitCount: number;
}

/**
 * Result of an idempotency check
 */
export interface IdempotencyCheckResult {
  /** Whether the request should proceed with upload */
  shouldUpload: boolean;
  /** The idempotency key to use */
  key: string;
  /** Content hash of the file */
  contentHash: string;
  /** Existing record if found (for returning cached response) */
  existingRecord?: IdempotencyRecord;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly keyPrefix = 'ipfs:idempotency:';
  private readonly defaultTtlSeconds = 86400; // 24 hours

  constructor(private readonly redisService: RedisService) {}

  /**
   * Generate an idempotency key from content hash
   */
  generateKey(contentHash: string, prefix = 'upload'): string {
    return `${this.keyPrefix}${prefix}:${contentHash}`;
  }

  /**
   * Calculate SHA-256 hash of file content
   */
  calculateContentHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Check if a request with the given idempotency key has already been processed
   * 
   * @param idempotencyKey - The idempotency key from request header
   * @param contentHash - SHA-256 hash of the file content
   * @param fileSize - Size of the file in bytes
   * @returns IdempotencyCheckResult indicating whether to proceed
   */
  async check(
    idempotencyKey: string | undefined,
    contentHash: string,
    fileSize: number,
  ): Promise<IdempotencyCheckResult> {
    // Generate or use provided key
    const key = idempotencyKey 
      ? `${this.keyPrefix}explicit:${idempotencyKey}`
      : this.generateKey(contentHash);

    // Look up existing record
    const record = await this.redisService.get<IdempotencyRecord>(key);

    if (record) {
      this.logger.debug(
        `Idempotent request detected: ${key}, hit count: ${record.hitCount + 1}`
      );

      // Increment hit count for monitoring
      record.hitCount++;
      await this.redisService.set(key, record, this.defaultTtlSeconds);

      return {
        shouldUpload: false,
        key,
        contentHash,
        existingRecord: record,
      };
    }

    return {
      shouldUpload: true,
      key,
      contentHash,
    };
  }

  /**
   * Store the result of an upload for future idempotent requests
   * 
   * @param key - The idempotency key
   * @param contentHash - SHA-256 hash of the file content
   * @param response - The upload response to cache
   */
  async storeResult(
    key: string,
    contentHash: string,
    response: { cid: string; gatewayUrls: string[] },
  ): Promise<void> {
    const record: IdempotencyRecord = {
      key,
      contentHash,
      response: {
        cid: response.cid,
        gatewayUrls: response.gatewayUrls,
        uploadedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      hitCount: 0,
    };

    await this.redisService.set(key, record, this.defaultTtlSeconds);
    
    this.logger.debug(`Stored idempotency record for key: ${key}`);
  }

  /**
   * Check if the provided content hash already exists in the store
   * 
   * @param contentHash - SHA-256 hash of the file content
   * @returns The existing record if found
   */
  async findByContentHash(
    contentHash: string,
  ): Promise<IdempotencyRecord | null> {
    const key = this.generateKey(contentHash);
    return this.redisService.get<IdempotencyRecord>(key);
  }

  /**
   * Clear an idempotency record (for testing or manual cleanup)
   * 
   * @param key - The idempotency key to clear
   */
  async clear(key: string): Promise<void> {
    await this.redisService.del(key);
    this.logger.debug(`Cleared idempotency record: ${key}`);
  }

  /**
   * Validate idempotency key format
   * 
   * @param key - The idempotency key to validate
   * @returns True if valid
   */
  isValidKeyFormat(key: string): boolean {
    // Keys should be alphanumeric with hyphens/underscores, 8-128 chars
    const pattern = /^[a-zA-Z0-9_-]{8,128}$/;
    return pattern.test(key);
  }

  /**
   * Sanitize idempotency key (remove invalid characters)
   * 
   * @param key - The raw idempotency key
   * @returns Sanitized key
   */
  sanitizeKey(key: string): string {
    // Remove any characters that aren't alphanumeric, hyphens, or underscores
    // Then limit length
    return key.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 128);
  }
}
