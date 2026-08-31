import { Injectable, Logger, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IpfsService } from '../../ipfs/services/ipfs.service';
import { AuditService } from '../../admin/audit.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import {
  EVIDENCE_ALLOWED_MIME_TYPES,
  EVIDENCE_MAX_BYTES_DEFAULT,
  EVIDENCE_UPLOAD_RATE_LIMIT_DEFAULT,
  EVIDENCE_UPLOAD_RATE_LIMIT_WINDOW_SECONDS_DEFAULT,
  EvidenceUploadResponseDto,
} from '../dto/evidence-upload.dto';

@Injectable()
export class EvidenceUploadService {
  private readonly logger = new Logger(EvidenceUploadService.name);
  private readonly maxBytes: number;

  constructor(
    private readonly ipfs: IpfsService,
    private readonly audit: AuditService,
    private readonly rateLimitService: RateLimitService,
    private readonly config: ConfigService,
  ) {
    this.maxBytes = this.config.get<number>('EVIDENCE_MAX_BYTES', EVIDENCE_MAX_BYTES_DEFAULT);
  }

  async upload(
    file: Express.Multer.File,
    walletAddress: string,
  ): Promise<EvidenceUploadResponseDto> {
    // 1. Validate before any IPFS interaction
    this.validateFile(file);

    // 2. Per-wallet rate limit
    await this.enforceRateLimit(walletAddress);

    // 3. Upload to IPFS
    let cid: string;
    let gatewayUrl: string;
    try {
      const result = await this.ipfs.upload(
        file.buffer,
        file.originalname,
        file.mimetype,
        undefined,
        { stripExif: true },
      );
      cid = result.cid;
      gatewayUrl = result.gatewayUrls[0];
    } catch (err) {
      await this.writeAudit(walletAddress, 'evidence_upload_failed', { reason: 'ipfs_error' });
      throw err;
    }

    // 4. Audit success
    await this.writeAudit(walletAddress, 'evidence_upload_success', {
      cid,
      mimeType: file.mimetype,
      size: file.size,
    });

    return {
      cid,
      gatewayUrl,
      fileSizeBytes: file.size,
      mimeType: file.mimetype,
    };
  }

  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const mime = file.mimetype as string;
    if (!(EVIDENCE_ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
      throw new BadRequestException(
        `Unsupported file type "${mime}". Allowed: ${EVIDENCE_ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    if (file.size > this.maxBytes) {
      throw new BadRequestException(
        `File exceeds maximum size of ${this.maxBytes} bytes`,
      );
    }

    // Guard against extension/MIME mismatch for known dangerous extensions
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const dangerousExtensions = ['exe', 'bat', 'sh', 'js', 'php', 'py', 'rb', 'cmd', 'ps1'];
    if (dangerousExtensions.includes(ext)) {
      throw new BadRequestException(`File extension ".${ext}" is not allowed`);
    }
  }

  private async enforceRateLimit(walletAddress: string): Promise<void> {
    const limit = this.config.get<number>('EVIDENCE_UPLOAD_RATE_LIMIT', EVIDENCE_UPLOAD_RATE_LIMIT_DEFAULT);
    const windowSeconds = this.config.get<number>(
      'EVIDENCE_UPLOAD_RATE_LIMIT_WINDOW_SECONDS',
      EVIDENCE_UPLOAD_RATE_LIMIT_WINDOW_SECONDS_DEFAULT,
    );

    const { allowed, retryAfterSeconds } = await this.rateLimitService.checkWalletEvidenceLimit(
      walletAddress,
      limit,
      windowSeconds,
    );

    if (!allowed) {
      await this.writeAudit(walletAddress, 'evidence_upload_rate_limited', {
        retryAfterSeconds,
      });
      throw new HttpException(
        `Upload rate limit exceeded. Retry after ${retryAfterSeconds}s`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async writeAudit(
    walletAddress: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.write({
        actor: walletAddress,
        action,
        payload: payload as Record<string, string | number | boolean | null>,
      });
    } catch (err) {
      // Audit failures must not block the upload response
      this.logger.warn(`Audit write failed for ${action}: ${err}`);
    }
  }
}
