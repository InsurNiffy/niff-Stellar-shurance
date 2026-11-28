import { Global, Module, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.constants';

export function buildRedisOptions(config: ConfigService): RedisOptions {
  return {
    host: config.get<string>('REDIS_HOST', '127.0.0.1'),
    port: config.get<number>('REDIS_PORT', 6379),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db: config.get<number>('REDIS_DB', 0),
    lazyConnect: false,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 200, 5000);
      Logger.warn(
        `Redis connection retry #${times} in ${delay}ms`,
        'RedisModule',
      );
      return delay;
    },
    reconnectOnError: (err: Error) => {
      Logger.error(`Redis reconnect on error: ${err.message}`, 'RedisModule');
      return true;
    },
  };
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const logger = new Logger('RedisModule');
        const client = new Redis(buildRedisOptions(config));

        client.on('connect', () => logger.log('Redis connecting...'));
        client.on('ready', () => logger.log('Redis connection ready'));
        client.on('error', (err: Error) =>
          logger.error(`Redis connection error: ${err.message}`),
        );
        client.on('close', () => logger.warn('Redis connection closed'));
        client.on('reconnecting', (delay: number) =>
          logger.warn(`Redis reconnecting in ${delay}ms`),
        );
        client.on('end', () => logger.warn('Redis connection ended'));

        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(private readonly redis: RedisService) {}

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing Redis connections');
    await this.redis.quit();
  }
}
