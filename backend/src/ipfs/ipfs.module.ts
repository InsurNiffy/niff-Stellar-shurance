/**
 * IPFS Module
 * 
 * Provides secure IPFS file upload functionality.
 * 
 * Features:
 * - Streaming file uploads
 * - Multiple IPFS provider support (Pinata, mock)
 * - Idempotency for duplicate prevention
 * - Rate limiting
 * - File validation and sanitization
 * - EXIF metadata stripping
 */
import { Module, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { IpfsController } from './ipfs.controller';
import { IpfsService } from './services/ipfs.service';
import { IdempotencyService } from './services/idempotency.service';
import { FileValidationService } from './services/file-validation.service';
import { MockIpfsProvider } from './providers/mock-ipfs.provider';
import { PinataIpfsProvider } from './providers/pinata-ipfs.provider';
import { IpfsProvider } from './interfaces/ipfs-provider.interface';

// Token for IPFS provider injection
export const IPFS_PROVIDER = 'IPFS_PROVIDER';

@Module({
  imports: [
    // Rate limiting configuration
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000, // 1 minute
        limit: 10, // 10 requests per minute
      },
      {
        name: 'medium',
        ttl: 3600000, // 1 hour
        limit: 100, // 100 requests per hour
      },
      {
        name: 'long',
        ttl: 86400000, // 1 day
        limit: 500, // 500 requests per day
      },
    ]),
  ],
  controllers: [IpfsController],
  providers: [
    // Services
    IpfsService,
    IdempotencyService,
    FileValidationService,
    
    // Provider selection based on configuration
    {
      provide: IPFS_PROVIDER,
      useFactory: (configService: ConfigService): IpfsProvider => {
        const providerType = configService.get<string>('IPFS_PROVIDER', 'mock');
        
        switch (providerType) {
          case 'pinata':
            return new PinataIpfsProvider(configService);
          case 'mock':
          default:
            return new MockIpfsProvider();
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [IpfsService, IPFS_PROVIDER],
})
export class IpfsModule implements OnModuleInit {
  private readonly logger = new Logger(IpfsModule.name);

  constructor(
    private readonly ipfsService: IpfsService,
    @Inject(IPFS_PROVIDER) private readonly ipfsProvider: IpfsProvider,
  ) {}

  onModuleInit() {
    // Set the provider on the service
    this.ipfsService.setProvider(this.ipfsProvider);
    this.logger.log(`IPFS module initialized with provider: ${this.ipfsProvider.name}`);
  }
}
