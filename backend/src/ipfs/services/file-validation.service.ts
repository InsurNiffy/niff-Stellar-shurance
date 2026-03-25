/**
 * File Validation Service
 * 
 * Validates and sanitizes uploaded files for security.
 * - Enforces file size limits
 * - Validates MIME types
 * - Sanitizes filenames
 * - Strips EXIF metadata (optional)
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface FileValidationResult {
  /** Sanitized filename */
  filename: string;
  /** Detected MIME type */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** SHA-256 hash of content */
  contentHash: string;
  /** Whether EXIF was stripped */
  exifStripped?: boolean;
}

/**
 * Allowed MIME types configuration
 */
export const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
  // Documents
  'application/pdf',
  // Audio/Video (optional - add if needed)
  // 'audio/mpeg',
  // 'video/mp4',
] as const;

/**
 * Dangerous file extensions that could execute code
 */
export const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.msi', '.dll', '.so', '.dylib',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.php', '.phtml', '.phar',
  '.py', '.pyw', '.pyc',
  '.rb', '.rake', '.gem',
  '.jar', '.war', '.ear',
  '.jsp', '.jspx', '.asp', '.aspx',
  '.cgi', '.pl', '.perl',
  '.sql', '.sqlite', '.db',
  '.htaccess', '.htpasswd',
  '.env', '.config', '.conf',
] as const;

/**
 * Extension to MIME type mapping for validation
 */
const EXTENSION_MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.pdf': 'application/pdf',
};

@Injectable()
export class FileValidationService {
  private readonly logger = new Logger(FileValidationService.name);
  
  /** Maximum file size in bytes (default: 50MB) */
  private readonly maxFileSize: number;
  
  /** Minimum file size in bytes (default: 1 byte) */
  private readonly minFileSize: number;
  
  /** Whether to strip EXIF metadata */
  private readonly stripExif: boolean;

  constructor(private readonly configService: ConfigService) {
    this.maxFileSize = this.configService.get<number>('IPFS_MAX_FILE_SIZE', 50 * 1024 * 1024);
    this.minFileSize = this.configService.get<number>('IPFS_MIN_FILE_SIZE', 1);
    this.stripExif = this.configService.get<boolean>('IPFS_STRIP_EXIF', true);
  }

  /**
   * Validate a file's metadata
   * 
   * @param file - File metadata from multer
   * @throws BadRequestException if validation fails
   */
  validateFileMetadata(file: {
    fieldname?: string;
    originalname?: string;
    mimetype?: string;
    size?: number;
  }): void {
    // Check required fields
    if (!file.fieldname) {
      throw new BadRequestException('File field name is required');
    }

    if (!file.originalname || file.originalname.trim().length === 0) {
      throw new BadRequestException('File name is required');
    }

    if (!file.mimetype) {
      throw new BadRequestException('File MIME type is required');
    }

    if (file.size === undefined || file.size === null) {
      throw new BadRequestException('File size is required');
    }

    // Validate file size
    if (file.size < this.minFileSize) {
      throw new BadRequestException(
        `File is too small. Minimum size is ${this.minFileSize} byte(s).`
      );
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `File is too large. Maximum size is ${this.formatBytes(this.maxFileSize)}.`
      );
    }

    // Validate MIME type
    if (!this.isAllowedMimeType(file.mimetype)) {
      throw new BadRequestException(
        `File type "${file.mimetype}" is not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
      );
    }

    // Validate filename extension
    const extension = this.getFileExtension(file.originalname).toLowerCase();
    if (this.isDangerousExtension(extension)) {
      throw new BadRequestException(
        `File extension "${extension}" is not allowed for security reasons.`
      );
    }

    // Check MIME type matches extension
    const expectedMime = EXTENSION_MIME_MAP[extension];
    if (expectedMime && file.mimetype !== expectedMime) {
      this.logger.warn(
        `MIME type mismatch: declared ${file.mimetype}, expected ${expectedMime} for .${extension}`
      );
      // We could reject here, but browsers often report incorrect MIME types
      // Log warning and continue with declared type
    }
  }

  /**
   * Check if MIME type is allowed
   */
  isAllowedMimeType(mimeType: string): boolean {
    return ALLOWED_MIME_TYPES.includes(mimeType as typeof ALLOWED_MIME_TYPES[number]);
  }

  /**
   * Check if file extension is dangerous
   */
  isDangerousExtension(extension: string): boolean {
    return DANGEROUS_EXTENSIONS.includes(extension as typeof DANGEROUS_EXTENSIONS[number]);
  }

  /**
   * Sanitize filename for safe storage
   */
  sanitizeFilename(filename: string): string {
    if (!filename) {
      return 'unnamed';
    }

    // Get the base name (remove path components)
    let name = filename.split(/[/\\]/).pop() || 'unnamed';
    
    // Get extension
    const extension = this.getFileExtension(name);
    let baseName = name.slice(0, -extension.length);

    // Remove any directory traversal attempts
    baseName = baseName.replace(/\.\./g, '');
    baseName = baseName.replace(/[<>:"|?*]/g, '');
    baseName = baseName.replace(/[\x00-\x1f\x7f]/g, ''); // Remove control characters

    // Limit length (leave room for extension and hash)
    if (baseName.length > 100) {
      baseName = baseName.substring(0, 100);
    }

    // If base name is empty or just dots/dashes, use generic name
    if (!baseName || /^[.-]+$/.test(baseName)) {
      baseName = 'file';
    }

    return baseName + extension;
  }

  /**
   * Get file extension including the dot
   */
  getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1 || lastDot === 0) {
      return '';
    }
    return filename.slice(lastDot);
  }

  /**
   * Calculate content hash for deduplication
   */
  calculateContentHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Detect MIME type from file content magic bytes
   * 
   * This is a fallback when the browser doesn't provide accurate MIME type.
   */
  detectMimeType(buffer: Buffer): string | null {
    // JPEG magic bytes: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'image/jpeg';
    }

    // PNG magic bytes: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'image/png';
    }

    // GIF magic bytes: 47 49 46 38
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
      return 'image/gif';
    }

    // PDF magic bytes: 25 50 44 46
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return 'application/pdf';
    }

    // WebP magic bytes: 52 49 46 46 ... 57 45 42 50
    if (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      return 'image/webp';
    }

    // BMP magic bytes: 42 4D
    if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
      return 'image/bmp';
    }

    return null;
  }

  /**
   * Strip EXIF metadata from JPEG images
   * 
   * EXIF data can contain sensitive information like:
   * - GPS coordinates
   * - Device information
   * - Timestamps
   * - Author information
   */
  async stripExifMetadata(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; stripped: boolean }> {
    if (!this.stripExif || mimeType !== 'image/jpeg') {
      return { buffer, stripped: false };
    }

    try {
      // Simple EXIF stripping: remove APP1 (EXIF) segment
      // JPEG structure: FFD8 [marker] [data] FFD9
      // We need to preserve SOI (FF D8) and EOI (FF D9)
      
      const result: number[] = [];
      result.push(0xFF, 0xD8); // SOI marker

      let i = 2;
      while (i < buffer.length - 1) {
        // Check for marker
        if (buffer[i] !== 0xFF) {
          // Not a marker, copy rest of data
          result.push(...buffer.slice(i));
          break;
        }

        const marker = buffer[i + 1];

        // Skip APP1 (EXIF) markers
        if (marker === 0xE1) {
          // Check if it's EXIF (starts with "Exif\0\0")
          if (
            buffer[i + 4] === 0x45 && // 'E'
            buffer[i + 5] === 0x78 && // 'x'
            buffer[i + 6] === 0x69 && // 'i'
            buffer[i + 7] === 0x66 && // 'f'
            buffer[i + 8] === 0x00 &&
            buffer[i + 9] === 0x00
          ) {
            // Skip this segment
            const segmentLength = (buffer[i + 2] << 8) | buffer[i + 3];
            i += 2 + segmentLength;
            continue;
          }
        }

        // Copy marker and segment
        if (marker === 0xD9) {
          // EOI marker
          result.push(0xFF, 0xD9);
          break;
        }

        if (marker === 0xD8) {
          // SOI marker (shouldn't appear here, but handle it)
          result.push(0xFF, 0xD8);
          i += 2;
          continue;
        }

        // Copy this segment
        const segmentLength = (buffer[i + 2] << 8) | buffer[i + 3];
        for (let j = 0; j < 2 + segmentLength && i + j < buffer.length; j++) {
          result.push(buffer[i + j]);
        }
        i += 2 + segmentLength;
      }

      const stripped = result.length < buffer.length;
      if (stripped) {
        this.logger.debug(`Stripped EXIF metadata: ${buffer.length} -> ${result.length} bytes`);
      }

      return { buffer: Buffer.from(result), stripped };
    } catch (error) {
      this.logger.warn(`Failed to strip EXIF metadata: ${error}`);
      return { buffer, stripped: false };
    }
  }

  /**
   * Format bytes to human-readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get configuration for documentation
   */
  getConfig(): {
    maxFileSize: number;
    maxFileSizeFormatted: string;
    minFileSize: number;
    allowedMimeTypes: readonly string[];
    stripExif: boolean;
  } {
    return {
      maxFileSize: this.maxFileSize,
      maxFileSizeFormatted: this.formatBytes(this.maxFileSize),
      minFileSize: this.minFileSize,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      stripExif: this.stripExif,
    };
  }
}
