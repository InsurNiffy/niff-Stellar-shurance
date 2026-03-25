/**
 * IPFS Service
 * 
 * Main service for IPFS file uploads.
 * Orchestrates validation, idempotency, provider selection, and antivirus scanning.
 */
import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IpfsProvider, IpfsUploadResult, generateGatewayUrls } from '../interfaces/ipfs-provider.interface';
import { IdempotencyService } from './idempotency.service';
import { FileValidationService } from './file-validation.service';

/**
 * Upload response format
 */
export interface IpfsUploadResponse {
  /** Content Identifier (CID) */
  cid: string;
  /** Gateway URLs where the content can be accessed */
  gatewayUrls: string[];
  /** Original filename (sanitized) */
  filename?: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Whether this was a duplicate request */
  duplicated?: boolean;
  /** Timestamp of upload */
  uploadedAt: string;
}

/**
 * Upload options
 */
export interface UploadOptions {
  /** Strip EXIF metadata from images */
  stripExif?: boolean;
  /** Run antivirus scan */
  scanForViruses?: boolean;
  /** Additional metadata to store with the file */
  metadata?: Record<string, string>;
}

/**
 * Antivirus scan result
 */
export interface ScanResult {
  clean: boolean;
  threats: string[];
}

@Injectable()
export class IpfsService {
  private readonly logger = new Logger(IpfsService.name);
  private provider!: IpfsProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly idempotencyService: IdempotencyService,
    private readonly fileValidationService: FileValidationService,
  ) {
    this.initializeProvider();
  }

  /**
   * Initialize the IPFS provider based on configuration
   */
  private initializeProvider(): void {
    // Import providers dynamically to avoid circular dependencies
    // Provider selection is done in the module
  }

  /**
   * Set the IPFS provider (called by module)
   */
  setProvider(provider: IpfsProvider): void {
    this.provider = provider;
    this.logger.log(`IPFS provider set to: ${provider.name}`);
  }

  /**
   * Upload a file to IPFS
   * 
   * @param buffer - File content as buffer
   * @param filename - Original filename
   * @param mimeType - MIME type
   * @param idempotencyKey - Optional idempotency key
   * @param options - Upload options
   */
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    idempotencyKey?: string,
    options?: UploadOptions,
  ): Promise<IpfsUploadResponse> {
    const startTime = Date.now();

    // Validate file
    this.fileValidationService.validateFileMetadata({
      originalname: filename,
      mimetype: mimeType,
      size: buffer.length,
    });

    // Sanitize filename
    const sanitizedFilename = this.fileValidationService.sanitizeFilename(filename);

    // Calculate content hash
    const contentHash = this.fileValidationService.calculateContentHash(buffer);

    // Strip EXIF if enabled
    let processedBuffer = buffer;
    if (options?.stripExif !== false) {
      const { buffer: stripped, stripped: wasStripped } = 
        await this.fileValidationService.stripExifMetadata(buffer, mimeType);
      processedBuffer = stripped;
      if (wasStripped) {
        this.logger.debug(`EXIF metadata stripped from ${filename}`);
      }
    }

    // Run antivirus scan if enabled
    if (options?.scanForViruses) {
      const scanResult = await this.scanForViruses(processedBuffer);
      if (!scanResult.clean) {
        throw new BadRequestException(
          `File rejected: potential security threat detected (${scanResult.threats.join(', ')})`
        );
      }
    }

    // Check idempotency
    const idempotencyCheck = await this.idempotencyService.check(
      idempotencyKey,
      contentHash,
      processedBuffer.length,
    );

    if (!idempotencyCheck.shouldUpload && idempotencyCheck.existingRecord) {
      this.logger.log(`Returning cached response for idempotent request: ${idempotencyCheck.key}`);
      return {
        ...idempotencyCheck.existingRecord.response,
        filename: sanitizedFilename,
        size: processedBuffer.length,
        mimeType,
        duplicated: true,
      };
    }

    // Check provider is available
    if (!this.provider) {
      throw new ServiceUnavailableException('IPFS provider not configured');
    }

    // Check provider health
    const isHealthy = await this.provider.isHealthy();
    if (!isHealthy) {
      throw new ServiceUnavailableException('IPFS provider is temporarily unavailable');
    }

    // Upload to IPFS
    this.logger.debug(`Uploading ${sanitizedFilename} (${processedBuffer.length} bytes) to IPFS`);
    
    let uploadResult: IpfsUploadResult;
    try {
      uploadResult = await this.provider.upload(
        processedBuffer,
        sanitizedFilename,
        mimeType,
        { metadata: options?.metadata },
      );
    } catch (error) {
      this.logger.error(`IPFS upload failed: ${error}`);
      throw new ServiceUnavailableException('Failed to upload to IPFS');
    }

    // Generate gateway URLs
    const gatewayUrls = generateGatewayUrls(uploadResult.cid);

    // Store result for idempotency
    await this.idempotencyService.storeResult(
      idempotencyCheck.key,
      contentHash,
      { cid: uploadResult.cid, gatewayUrls },
    );

    const duration = Date.now() - startTime;
    this.logger.log(
      `Uploaded ${sanitizedFilename} -> ${uploadResult.cid} in ${duration}ms`
    );

    return {
      cid: uploadResult.cid,
      gatewayUrls,
      filename: sanitizedFilename,
      size: uploadResult.size,
      mimeType: uploadResult.mimeType,
      uploadedAt: new Date().toISOString(),
    };
  }

  /**
   * Mock antivirus scanning
   * 
   * In production, this would integrate with a real antivirus solution like:
   * - ClamAV
   * - VirusTotal API
   * - Cloudflare Magic Transit
   * 
   * For now, this is a placeholder that always returns clean.
   */
  private async scanForViruses(buffer: Buffer): Promise<ScanResult> {
    // This is a mock implementation
    // In production, integrate with actual antivirus service
    
    // Check for obvious malware signatures (very basic)
    const suspiciousPatterns = [
      Buffer.from('eval(atob('),
      Buffer.from('<script>eval('),
      Buffer.from('function(){'),
    ];

    const threats: string[] = [];
    
    for (const pattern of suspiciousPatterns) {
      if (buffer.includes(pattern)) {
        threats.push('Suspicious code pattern detected');
        break;
      }
    }

    return {
      clean: threats.length === 0,
      threats,
    };
  }

  /**
   * Check if content exists on IPFS
   */
  async exists(cid: string): Promise<boolean> {
    if (!this.provider?.exists) {
      return false;
    }
    return this.provider.exists(cid);
  }

  /**
   * Unpin content from IPFS
   */
  async unpin(cid: string): Promise<boolean> {
    if (!this.provider?.unpin) {
      throw new BadRequestException('Provider does not support unpinning');
    }
    return this.provider.unpin(cid);
  }

  /**
   * Get provider health status
   */
  async isHealthy(): Promise<boolean> {
    if (!this.provider) {
      return false;
    }
    return this.provider.isHealthy();
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return this.provider?.name || 'unknown';
  }

  /**
   * Get configuration for documentation
   */
  getConfig() {
    return this.fileValidationService.getConfig();
  }
}
