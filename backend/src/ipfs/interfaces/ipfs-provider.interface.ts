/**
 * IPFS Provider Interface
 * 
 * Defines the contract for IPFS storage providers.
 * Implement this interface to add support for different IPFS backends:
 * - Pinata (https://pinata.cloud)
 * - web3.storage (https://web3.storage)
 * - Custom IPFS nodes
 * - Local IPFS daemons
 */
export interface IpfsUploadResult {
  /** Content Identifier (CID) of the uploaded content */
  cid: string;
  /** Size of the content in bytes */
  size: number;
  /** MIME type of the content */
  mimeType: string;
  /** Original filename before sanitization */
  originalName?: string;
  /** Timestamp when the content was pinned */
  pinnedAt?: Date;
}

export interface IpfsProvider {
  /**
   * Unique identifier for this provider
   */
  readonly name: string;

  /**
   * Upload a file to IPFS using streaming
   * 
   * @param buffer - The file content as a Buffer (may be large)
   * @param filename - Sanitized filename for the content
   * @param mimeType - MIME type of the content
   * @param options - Optional provider-specific options
   * @returns Upload result with CID and metadata
   */
  upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options?: Record<string, unknown>,
  ): Promise<IpfsUploadResult>;

  /**
   * Check if content with given CID exists on the provider
   * 
   * @param cid - Content Identifier to check
   * @returns True if content exists
   */
  exists?(cid: string): Promise<boolean>;

  /**
   * Unpin content from IPFS (if supported by provider)
   * 
   * @param cid - Content Identifier to unpin
   * @returns True if unpinned successfully
   */
  unpin?(cid: string): Promise<boolean>;

  /**
   * Get health status of the provider connection
   * 
   * @returns True if provider is healthy
   */
  isHealthy(): Promise<boolean>;
}

export interface IpfsGatewayConfig {
  /** Gateway URL pattern (use {{cid}} as placeholder) */
  url: string;
  /** Whether this gateway supports public writes */
  isPublic?: boolean;
  /** Priority for selection (lower = higher priority) */
  priority?: number;
}

export const IPFS_GATEWAYS: IpfsGatewayConfig[] = [
  { url: 'https://ipfs.io/ipfs/{{cid}}', isPublic: true, priority: 1 },
  { url: 'https://cloudflare-ipfs.com/ipfs/{{cid}}', isPublic: true, priority: 2 },
  { url: 'https://gateway.pinata.cloud/ipfs/{{cid}}', isPublic: true, priority: 3 },
  { url: 'https://dweb.link/ipfs/{{cid}}', isPublic: true, priority: 4 },
];

/**
 * Generate gateway URLs for a given CID
 */
export function generateGatewayUrls(cid: string): string[] {
  return IPFS_GATEWAYS.map(
    (gateway) => gateway.url.replace('{{cid}}', cid)
  );
}
