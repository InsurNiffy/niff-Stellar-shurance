/**
 * Pinata IPFS Provider
 * 
 * Implementation for Pinata.cloud IPFS pinning service.
 * Provides secure API key management and streaming upload support.
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Readable } from 'stream';
import { IpfsProvider, IpfsUploadResult } from '../interfaces/ipfs-provider.interface';

/**
 * Pinata API response types
 */
interface PinataPinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

interface PinataPinListResponse {
  count: number;
  rows: Array<{
    ipfs_pin_hash: string;
    size: number;
    timestamp: string;
  }>;
}

@Injectable()
export class PinataIpfsProvider implements IpfsProvider {
  readonly name = 'pinata';
  private readonly logger = new Logger(PinataIpfsProvider.name);
  private readonly client: AxiosInstance;
  private readonly gatewayUrl: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('PINATA_API_KEY');
    const apiSecret = this.configService.get<string>('PINATA_API_SECRET');
    
    if (!apiKey || !apiSecret) {
      this.logger.warn('Pinata API credentials not configured. Provider will be unavailable.');
    }

    this.client = axios.create({
      baseURL: 'https://api.pinata.cloud',
      headers: {
        pinata_api_key: apiKey || '',
        pinata_secret_api_key: apiSecret || '',
      },
      timeout: 60000, // 60 second timeout for large files
    });

    this.gatewayUrl = this.configService.get<string>(
      'PINATA_GATEWAY_URL',
      'https://gateway.pinata.cloud/ipfs'
    );
  }

  /**
   * Upload file to Pinata using streaming-compatible approach
   */
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options?: Record<string, unknown>,
  ): Promise<IpfsUploadResult> {
    const apiKey = this.configService.get<string>('PINATA_API_KEY');
    const apiSecret = this.configService.get<string>('PINATA_API_SECRET');

    if (!apiKey || !apiSecret) {
      throw new UnauthorizedException('Pinata API credentials not configured');
    }

    try {
      // Create a readable stream from buffer
      const stream = new Readable();
      stream.push(buffer);
      stream.push(null);

      // Build multipart form data manually
      const boundary = `----FormBoundary${Date.now().toString(16)}`;
      const header = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}\r\n`);
      const metadataHeader = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="pinataMetadata"\r\nContent-Type: application/json\r\n\r\n`
      );
      const metadata = JSON.stringify({
        name: filename,
        keyvalues: options?.metadata as Record<string, string> || {},
      });
      const optionsHeader = Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="pinataOptions"\r\nContent-Type: application/json\r\n\r\n`
      );
      const pinataOptions = JSON.stringify({ cidVersion: 1 });

      // Calculate total length
      const totalLength =
        header.length +
        buffer.length +
        footer.length +
        metadataHeader.length +
        Buffer.byteLength(metadata) +
        optionsHeader.length +
        Buffer.byteLength(pinataOptions);

      this.logger.debug(`Uploading ${filename} (${buffer.length} bytes) to Pinata`);

      const response = await axios.post<PinataPinResponse>(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        stream,
        {
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': totalLength,
            pinata_api_key: apiKey,
            pinata_secret_api_key: apiSecret,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          // Transform request data for proper multipart encoding
          transformRequest: [(data) => {
            const chunks: Buffer[] = [];
            
            // File part
            chunks.push(header);
            chunks.push(buffer);
            
            // Metadata part
            chunks.push(metadataHeader);
            chunks.push(Buffer.from(metadata));
            
            // Options part
            chunks.push(optionsHeader);
            chunks.push(Buffer.from(pinataOptions));
            
            // Footer
            chunks.push(footer);
            
            return Buffer.concat(chunks);
          }],
        }
      );

      const result: IpfsUploadResult = {
        cid: response.data.IpfsHash,
        size: response.data.PinSize,
        mimeType,
        originalName: filename,
        pinnedAt: new Date(response.data.Timestamp),
      };

      this.logger.log(`Successfully pinned ${result.cid} to IPFS via Pinata`);
      
      return result;
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: string }; status?: number }; message?: string };
      const errorMessage = axiosError?.response?.data?.error || axiosError?.message || 'Unknown error';
      this.logger.error(`Pinata upload failed: ${errorMessage}`);
      throw new Error(`Pinata upload failed: ${errorMessage}`);
    }
  }

  /**
   * Check if content exists on Pinata
   */
  async exists(cid: string): Promise<boolean> {
    try {
      const apiKey = this.configService.get<string>('PINATA_API_KEY');
      const apiSecret = this.configService.get<string>('PINATA_API_SECRET');
      
      if (!apiKey || !apiSecret) {
        return false;
      }

      const response = await this.client.get<PinataPinListResponse>('/data/pinList', {
        params: {
          hashContains: cid,
          status: 'pinned',
        },
      });
      return response.data.rows.some((row) => row.ipfs_pin_hash === cid);
    } catch {
      return false;
    }
  }

  /**
   * Unpin content from Pinata
   */
  async unpin(cid: string): Promise<boolean> {
    try {
      const apiKey = this.configService.get<string>('PINATA_API_KEY');
      const apiSecret = this.configService.get<string>('PINATA_API_SECRET');
      
      if (!apiKey || !apiSecret) {
        return false;
      }

      await this.client.delete(`/pinning/unpin/${cid}`, {
        headers: {
          pinata_api_key: apiKey,
          pinata_secret_api_key: apiSecret,
        },
      });
      this.logger.log(`Unpinned ${cid} from Pinata`);
      return true;
    } catch (error: unknown) {
      const axiosError = error as { response?: { status?: number } };
      if (axiosError?.response?.status === 404) {
        return false;
      }
      this.logger.error(`Failed to unpin ${cid}: ${error}`);
      return false;
    }
  }

  /**
   * Check if Pinata API is accessible
   */
  async isHealthy(): Promise<boolean> {
    try {
      const apiKey = this.configService.get<string>('PINATA_API_KEY');
      const apiSecret = this.configService.get<string>('PINATA_API_SECRET');
      
      if (!apiKey || !apiSecret) {
        return false;
      }

      await axios.get('https://api.pinata.cloud/data/testAuthentication', {
        headers: {
          pinata_api_key: apiKey,
          pinata_secret_api_key: apiSecret,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get public gateway URL for a CID
   */
  getGatewayUrl(cid: string): string {
    return `${this.gatewayUrl}/${cid}`;
  }
}
