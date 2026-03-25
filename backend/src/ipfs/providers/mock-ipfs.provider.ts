/**
 * Mock IPFS Provider
 * 
 * A mock implementation for testing purposes.
 * Generates fake CIDs and simulates upload behavior without actual IPFS integration.
 */
import { Injectable, Logger } from '@nestjs/common';
import { IpfsProvider, IpfsUploadResult } from '../interfaces/ipfs-provider.interface';

/**
 * Generate a mock CID (Content Identifier)
 * Format:Qm[44 random base58 chars] - mimics IPFS v0 CID format
 */
function generateMockCid(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = 'Qm';
  for (let i = 0; i < 44; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

@Injectable()
export class MockIpfsProvider implements IpfsProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(MockIpfsProvider.name);
  
  // Simulated storage for testing
  private storage = new Map<string, IpfsUploadResult>();

  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    _options?: Record<string, unknown>,
  ): Promise<IpfsUploadResult> {
    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 100));

    const cid = generateMockCid();
    
    const result: IpfsUploadResult = {
      cid,
      size: buffer.length,
      mimeType,
      originalName: filename,
      pinnedAt: new Date(),
    };

    // Store for later verification in tests
    this.storage.set(cid, result);
    
    this.logger.debug(`Mock upload: ${filename} -> ${cid} (${buffer.length} bytes)`);
    
    return result;
  }

  async exists(cid: string): Promise<boolean> {
    return this.storage.has(cid);
  }

  async unpin(cid: string): Promise<boolean> {
    return this.storage.delete(cid);
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  /**
   * Get stored result by CID (for testing)
   */
  getStored(cid: string): IpfsUploadResult | undefined {
    return this.storage.get(cid);
  }

  /**
   * Get all stored CIDs (for testing)
   */
  getAllCids(): string[] {
    return Array.from(this.storage.keys());
  }

  /**
   * Clear all stored data (for testing)
   */
  clear(): void {
    this.storage.clear();
  }
}
