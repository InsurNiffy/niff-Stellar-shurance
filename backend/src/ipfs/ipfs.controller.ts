/**
 * IPFS Controller
 * 
 * Handles file uploads to IPFS via streaming multipart/form-data.
 * 
 * Security features:
 * - JWT authentication (optional for authenticated users)
 * - Rate limiting
 * - Idempotency key support
 * - File validation and sanitization
 */
import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { IpfsService, IpfsUploadResponse } from './services/ipfs.service';
import { FileValidationService } from './services/file-validation.service';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { Multer } from 'multer';

/**
 * DTO for upload options (query params)
 */
class UploadQueryDto {
  /** Strip EXIF metadata from images (default: true) */
  stripExif?: boolean = true;
  /** Run antivirus scan (default: false) */
  scanForViruses?: boolean = false;
}

@ApiTags('IPFS')
@Controller('ipfs')
export class IpfsController {
  private readonly logger = new Logger(IpfsController.name);

  constructor(
    private readonly ipfsService: IpfsService,
    private readonly fileValidationService: FileValidationService,
  ) {}

  /**
   * Upload a file to IPFS
   * 
   * POST /ipfs/upload
   * Content-Type: multipart/form-data
   * 
   * Headers:
   * - Content-Type: multipart/form-data
   * - Authorization: Bearer <jwt_token> (optional)
   * - Idempotency-Key: <unique_key> (optional, recommended)
   * 
   * Body:
   * - file: The file to upload (required)
   */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 52428800, // 50MB - configured via FileValidationService
        files: 1,
      },
    }),
  )
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Upload file to IPFS',
    description: `
      Upload a file to IPFS via streaming multipart upload.
      
      **Security Features:**
      - JWT authentication (optional)
      - Rate limiting: 10 uploads per minute
      - Idempotency support via Idempotency-Key header
      - Automatic EXIF metadata stripping for images
      
      **IPFS Considerations:**
      - Content uploaded to IPFS is immutable and permanent
      - Content cannot be deleted from IPFS once pinned
      - Consider GDPR implications before uploading personal data
      - Use a unique Idempotency-Key header to prevent duplicate uploads
    `,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'File to upload (max 50MB)',
        },
      },
    },
  })
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT Bearer token (optional)',
    required: false,
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Unique key to prevent duplicate uploads (recommended)',
    required: false,
  })
  @ApiQuery({ name: 'stripExif', required: false, type: Boolean, description: 'Strip EXIF metadata (default: true)' })
  @ApiQuery({ name: 'scanForViruses', required: false, type: Boolean, description: 'Run antivirus scan (default: false)' })
  @ApiResponse({
    status: 200,
    description: 'File uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        cid: { type: 'string', example: 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco' },
        gatewayUrls: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'https://ipfs.io/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
            'https://cloudflare-ipfs.com/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
          ],
        },
        filename: { type: 'string', example: 'document.pdf' },
        size: { type: 'number', example: 123456 },
        mimeType: { type: 'string', example: 'application/pdf' },
        duplicated: { type: 'boolean', example: false },
        uploadedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid file or request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 413, description: 'File too large' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @ApiResponse({ status: 503, description: 'IPFS provider unavailable' })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Query() query: UploadQueryDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Req() _request?: Request,
  ): Promise<IpfsUploadResponse> {
    // Validate file was provided
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate file metadata
    this.fileValidationService.validateFileMetadata(file);

    // Validate idempotency key if provided
    let sanitizedIdempotencyKey: string | undefined;
    if (idempotencyKey) {
      sanitizedIdempotencyKey = idempotencyKey.trim();
      if (sanitizedIdempotencyKey.length < 8 || sanitizedIdempotencyKey.length > 128) {
        throw new BadRequestException(
          'Idempotency-Key must be between 8 and 128 characters',
        );
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(sanitizedIdempotencyKey)) {
        throw new BadRequestException(
          'Idempotency-Key must contain only alphanumeric characters, hyphens, and underscores',
        );
      }
    }

    // Log metadata only (never log file contents)
    this.logger.log(
      `Upload request: filename="${file.originalname}", ` +
      `size=${file.size}, mimeType=${file.mimetype}, ` +
      `idempotencyKey=${sanitizedIdempotencyKey || 'none'}`,
    );

    // Upload to IPFS
    const result = await this.ipfsService.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      sanitizedIdempotencyKey,
      {
        stripExif: query.stripExif !== false,
        scanForViruses: query.scanForViruses === true,
      },
    );

    return result;
  }

  /**
   * Get upload configuration and limits
   * 
   * GET /ipfs/config
   */
  @Get('config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get upload configuration',
    description: 'Returns the allowed file types, size limits, and other upload configuration.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload configuration',
    schema: {
      type: 'object',
      properties: {
        maxFileSize: { type: 'number', description: 'Maximum file size in bytes' },
        maxFileSizeFormatted: { type: 'string', example: '50 MB' },
        minFileSize: { type: 'number', description: 'Minimum file size in bytes' },
        allowedMimeTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of allowed MIME types',
        },
        stripExif: { type: 'boolean', description: 'Whether EXIF metadata is stripped' },
        rateLimit: {
          type: 'object',
          properties: {
            uploadsPerMinute: { type: 'number', example: 10 },
          },
        },
        ipfsImmutability: {
          type: 'object',
          properties: {
            warning: { type: 'string' },
            gdprNote: { type: 'string' },
          },
        },
      },
    },
  })
  getConfig() {
    const config = this.fileValidationService.getConfig();
    return {
      maxFileSize: config.maxFileSize,
      maxFileSizeFormatted: config.maxFileSizeFormatted,
      minFileSize: config.minFileSize,
      allowedMimeTypes: config.allowedMimeTypes,
      stripExif: config.stripExif,
      rateLimit: {
        uploadsPerMinute: 10,
      },
      ipfsImmutability: {
        warning: 'Content uploaded to IPFS is permanent and cannot be deleted.',
        gdprNote:
          'Do not upload personal data unless you have explicit consent. IPFS content may be cached on multiple nodes globally.',
        recommendation: 'Consider encrypting sensitive files before upload.',
      },
    };
  }

  /**
   * Health check for IPFS service
   * 
   * GET /ipfs/health
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check IPFS service health',
    description: 'Returns the health status of the IPFS provider.',
  })
  @ApiResponse({
    status: 200,
    description: 'Health status',
    schema: {
      type: 'object',
      properties: {
        healthy: { type: 'boolean' },
        provider: { type: 'string' },
      },
    },
  })
  async healthCheck() {
    const isHealthy = await this.ipfsService.isHealthy();
    return {
      healthy: isHealthy,
      provider: this.ipfsService.getProviderName(),
    };
  }
}
