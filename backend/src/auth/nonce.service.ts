/**
 * NonceService — single-use nonce store backed by Redis (via CacheModule).
 *
 * Nonces are stored with a TTL and deleted on first use to prevent replay attacks.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../cache/redis.service';

interface StoredChallenge {
  publicKey: string;
  message: string;
}

@Injectable()
export class NonceService {
  private readonly logger = new Logger(NonceService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.ttlSeconds = this.configService.get<number>('NONCE_TTL_SECONDS', 300);
  }

  async store(nonce: string, data: StoredChallenge): Promise<void> {
    await this.redis.set(`nonce:${nonce}`, data, this.ttlSeconds);
  }

  async consume(nonce: string): Promise<StoredChallenge | null> {
    const data = await this.redis.get<StoredChallenge>(`nonce:${nonce}`);
    if (!data) return null;
    // Delete before returning — single-use guarantee
    await this.redis.del(`nonce:${nonce}`);
    return data;
  }
}
