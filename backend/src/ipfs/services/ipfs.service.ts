/**
 * IPFS Service
 * 
 * Main service for IPFS file uploads.
 * Orchestrates validation, idempotency, provider chain fallback, and antivirus scanning.
 */
import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IpfsUploadResult, generateGatewayUrls, IpfsGatewayConfig, IPFS_GATEWAYS } from '../interfaces/ipfs-provider.interface';
import { IdempotencyService } from './idempotency.service';
import { FileValidationService } from './file-validation.service';
import { IpfsProviderChainService } from './ipfs-provider-chain.service';

/**
 * Upload response format
 */
export interface IpfsUploadResponse {
  /** Content Identifier (CID) */
  cid: string;
  /** Gateway URLs where the content can be accessed */
  gatewayUrls: string[];
  /** SHA-256 hex (64 chars) of uploaded bytes (after EXIF strip); for `file_claim` evidence. */
  contentSha256Hex: string;
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
  private gateways: IpfsGatewayConfig[];

  constructor(
    private readonly configService: ConfigService,
    private readonly idempotencyService: IdempotencyService,
    private readonly fileValidationService: FileValidationService,
    private readonly providerChain: IpfsProviderChainService,
  ) {
    this.gateways = this.parseConfiguredGateways();
  }

  private parseConfiguredGateways(): IpfsGatewayConfig[] {
    const raw = this.configService.get<string>('ALLOWED_IPFS_GATEWAYS', '');
    if (!raw.trim()) {
      return IPFS_GATEWAYS;
    }

    const gateways = raw
      .split(',')
      .map((url, index) => ({
        url: url.trim(),
        isPublic: true,
        priority: index,
      }))
      .filter((g) => g.url);

    if (gateways.length === 0) {
      return IPFS_GATEWAYS;
    }

    this.logger.log(`Using ${gateways.length} configured IPFS gateway(s)`);
    return gateways;
  }

  /**
   * Set the provider chain (called by module during init)
   */
  setProviderChain(_providerChain: IpfsProviderChainService): void {
    // Injected via constructor; this method kept for backwards compatibility
    this.logger.log('IPFS provider chain initialized');
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
      const cached = idempotencyCheck.existingRecord.response;
      return {
        cid: cached.cid,
        gatewayUrls: cached.gatewayUrls,
        contentSha256Hex:
          cached.contentSha256Hex ?? idempotencyCheck.contentHash,
        filename: sanitizedFilename,
        size: processedBuffer.length,
        mimeType,
        duplicated: true,
        uploadedAt: cached.uploadedAt,
      };
    }

    const contentSha256Hex =
      this.fileValidationService.calculateContentHash(processedBuffer);

    // Upload to IPFS via provider chain (handles fallback automatically)
    this.logger.debug(`Uploading ${sanitizedFilename} (${processedBuffer.length} bytes) to IPFS`);

    let uploadResult: IpfsUploadResult;
    try {
      const chainResult = await this.providerChain.upload(
        processedBuffer,
        sanitizedFilename,
        mimeType,
        { metadata: options?.metadata },
      );
      uploadResult = chainResult;
      if (chainResult.fallbackCount > 0) {
        this.logger.log(
          `IPFS upload succeeded via ${chainResult.providerName} after ${chainResult.fallbackCount} fallback(s)`,
        );
      }
    } catch (error) {
      this.logger.error(`IPFS upload failed: ${error}`);
      throw new ServiceUnavailableException('Failed to upload to IPFS');
    }

    // Generate gateway URLs using configured gateways
    const gatewayUrls = generateGatewayUrls(uploadResult.cid, this.gateways);

    // Store result for idempotency
    await this.idempotencyService.storeResult(
      idempotencyCheck.key,
      contentHash,
      { cid: uploadResult.cid, gatewayUrls, contentSha256Hex },
    );

    const duration = Date.now() - startTime;
    this.logger.log(
      `Uploaded ${sanitizedFilename} -> ${uploadResult.cid} in ${duration}ms`
    );

    return {
      cid: uploadResult.cid,
      gatewayUrls,
      contentSha256Hex,
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
    const result = await this.providerChain.exists(cid);
    return result.exists;
  }

  /**
   * Unpin content from IPFS
   */
  async unpin(cid: string): Promise<boolean> {
    const result = await this.providerChain.unpin(cid);
    if (!result.success) {
      throw new BadRequestException('No healthy provider supports unpinning');
    }
    return true;
  }

  /**
   * Get provider health status
   */
  async isHealthy(): Promise<boolean> {
    return this.providerChain.getHealthyProviders().length > 0;
  }

  /**
   * Get primary provider name
   */
  getProviderName(): string {
    return this.providerChain.getPrimaryProviderName();
  }

  /**
   * Get full health status for all providers
   */
  getProviderHealthStatus() {
    return this.providerChain.getHealthStatus();
  }

  /**
   * Fetch content from IPFS with gateway fallback
   * Tries each gateway in order until one succeeds or all fail
   */
  async fetchFromGateway(cid: string): Promise<Buffer> {
    const gatewayUrls = generateGatewayUrls(cid, this.gateways);
    const errors: Array<{ url: string; error: string }> = [];

    for (const url of gatewayUrls) {
      try {
        this.logger.debug(`Fetching ${cid} from gateway: ${url}`);
        const { default: axios } = await import('axios');
        const response = await axios.get<Buffer>(url, {
          responseType: 'arraybuffer',
          timeout: 30_000,
        });
        this.logger.log(`Successfully fetched ${cid} from ${url}`);
        return Buffer.from(response.data);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ url, error: message });
        this.logger.warn(`Failed to fetch from ${url}: ${message}`);
      }
    }

    const errorSummary = errors.map((e) => `${e.url}: ${e.error}`).join('; ');
    this.logger.error(`Failed to fetch ${cid} from all gateways: ${errorSummary}`);
    throw new ServiceUnavailableException(
      `Failed to fetch IPFS content ${cid}: all gateways unavailable`,
    );
  }

  /**
   * Get configuration for documentation
   */
  getConfig() {
    return this.fileValidationService.getConfig();
  }
}
