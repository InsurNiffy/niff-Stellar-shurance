import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export interface IpfsUploadResult {
  cid: string;
  url: string;
  fileSizeBytes: number;
  mimeType: string;
}

export interface IpfsProvider {
  readonly name: string;
  upload(file: Buffer, mimeType: string): Promise<{ cid: string }>;
}

export interface IpfsUploadOptions {
  maxFileSizeBytes?: number;
  allowedMimeTypes?: string[];
  expectedContentHash?: string;
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const DEFAULT_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
];

@Injectable()
class IpfsProviderChainService {
  private readonly logger = new Logger(IpfsProviderChainService.name);
  private readonly providers: IpfsProvider[];

  constructor(providers: IpfsProvider[] = []) {
    this.providers = providers;
  }

  async upload(
    file: Buffer,
    mimeType: string,
    options: IpfsUploadOptions = {},
  ): Promise<IpfsUploadResult> {
    const maxFileSizeBytes =
      options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const allowedMimeTypes =
      options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;

    this.validate(file, mimeType, maxFileSizeBytes, allowedMimeTypes, options.expectedContentHash);

    if (this.providers.length === 0) {
      throw new BadRequestException('No IPFS providers configured');
    }

    const failures: string[] = [];
    for (const provider of this.providers) {
      try {
        const { cid } = await provider.upload(file, mimeType);
        if (!cid) {
          throw new Error('Provider returned empty CID');
        }
        return {
          cid,
          url: `ipfs://${cid}`,
          fileSizeBytes: file.length,
          mimeType,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `IPFS provider "${provider.name}" failed: ${message}`,
        );
        failures.push(`${provider.name}: ${message}`);
      }
    }

    throw new BadRequestException(
      `All IPFS providers failed: ${failures.join('; ')}`,
    );
  }

  private validate(
    file: Buffer,
    mimeType: string,
    maxFileSizeBytes: number,
    allowedMimeTypes: string[],
    expectedContentHash?: string,
  ): void {
    if (!file || file.length === 0) {
      throw new BadRequestException('File is empty');
    }
    if (file.length > maxFileSizeBytes) {
      throw new BadRequestException(
        `File size ${file.length} exceeds maximum of ${maxFileSizeBytes} bytes`,
      );
    }
    if (!allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `MIME type "${mimeType}" is not allowed`,
      );
    }
    if (expectedContentHash) {
      const actualHash = createHash('sha256').update(file).digest('hex');
      if (actualHash !== expectedContentHash) {
        throw new BadRequestException('Content hash mismatch');
      }
    }
  }
}

export { IpfsProviderChainService };
