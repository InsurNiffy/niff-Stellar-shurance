import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { TxController } from './tx.controller';
import { TxService } from './tx.service';
import { AuthModule } from '../auth/auth.module';
import { RedisService } from '../cache/redis.service';
import { startTxSubmitWorker } from './tx.worker';
import { closeTxSubmitQueue } from './tx.queue';

@Module({
  // CacheModule is @Global() so RedisService is available without importing here.
  // AuthModule exports PassportModule needed by OptionalJwtAuthGuard.
  imports: [AuthModule],
  controllers: [TxController],
  providers: [TxService],
})
export class TxModule implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    // Skip worker in test environment — tests start their own workers
    if (process.env.NODE_ENV === 'test') return;

    this.worker = startTxSubmitWorker({
      redis: this.redisService,
      rpcUrl: this.configService.get<string>(
        'SOROBAN_RPC_URL',
        'https://soroban-testnet.stellar.org',
      ),
      networkPassphrase: this.configService.get<string>(
        'STELLAR_NETWORK_PASSPHRASE',
        'Test SDF Network ; September 2015',
      ),
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await closeTxSubmitQueue();
  }
}
