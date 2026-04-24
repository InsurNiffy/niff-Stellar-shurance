import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Private/reserved IP ranges that must never be fetched server-side (SSRF prevention).
 * Covers RFC 1918, loopback, link-local, and other non-routable ranges.
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // loopback
  /^10\./,                           // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,     // RFC 1918
  /^192\.168\./,                     // RFC 1918
  /^169\.254\./,                     // link-local
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
  /^0\./,                            // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT (RFC 6598)
  /^localhost$/i,
];

/** Default allowlist used when ALLOWED_IPFS_GATEWAYS env var is not set. */
const DEFAULT_ALLOWED_GATEWAYS = [
  'ipfs.io',
  'cloudflare-ipfs.com',
  'gateway.pinata.cloud',
  'dweb.link',
  'nftstorage.link',
];

@Injectable()
export class SanitizationService {
  private readonly allowedDomains: Set<string>;

  constructor(config?: ConfigService) {
    const raw = config?.get<string>('ALLOWED_IPFS_GATEWAYS') ?? '';
    const configured = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    this.allowedDomains = new Set(
      configured.length ? configured : DEFAULT_ALLOWED_GATEWAYS,
    );
  }

  // Stellar address pattern (starts with G, 56 chars)
  private readonly stellarAddressPattern = /^G[A-Z0-9]{55}$/i;

  // IPFS CID v0 (starts with Qm, 46 chars) and v1 patterns
  private readonly ipfsHashPattern = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$|^[a-z0-9]{59}$/i;

  // HTML dangerous patterns for XSS
  private readonly xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
    /<link/gi,
    /<meta/gi,
    /<svg\s+onload/gi,
    /data:/gi,
  ];

  /**
   * Sanitize IPFS hash - validate format and normalize
   */
  sanitizeIpfsHash(hash: string): string {
    if (!hash || typeof hash !== 'string') {
      return '';
    }

    const trimmed = hash.trim();
    
    // Validate IPFS CID format
    if (!this.ipfsHashPattern.test(trimmed)) {
      // Return empty for invalid hashes
      return '';
    }

    return trimmed;
  }

  /**
   * Sanitize wallet address - validate Stellar format
   */
  sanitizeWalletAddress(address: string): string {
    if (!address || typeof address !== 'string') {
      return '';
    }

    const trimmed = address.trim().toUpperCase();
    
    // Validate Stellar address format
    if (!this.stellarAddressPattern.test(trimmed)) {
      return '';
    }

    return trimmed;
  }

  /**
   * Sanitize user-provided description to prevent XSS
   */
  sanitizeDescription(description: string): string {
    if (!description || typeof description !== 'string') {
      return '';
    }

    let sanitized = description;

    // Remove HTML tags and XSS patterns
    for (const pattern of this.xssPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Encode HTML entities
    sanitized = this.encodeHtmlEntities(sanitized);

    // Additional cleanup
    return sanitized
      .trim()
      .substring(0, 5000); // Limit length
  }

  /**
   * Encode HTML entities
   */
  private encodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;',
    };

    return text.replace(/[&<>"'`=/]/g, (char) => entities[char] || char);
  }

  /**
   * Returns true if the hostname resolves to a private/reserved IP range.
   * Used to block SSRF attempts via crafted evidence URLs.
   */
  isPrivateHost(hostname: string): boolean {
    return PRIVATE_IP_PATTERNS.some((re) => re.test(hostname));
  }

  /**
   * Sanitize evidence URL — validate against allowed gateway domains and
   * block SSRF attempts targeting private IP ranges or non-HTTPS schemes.
   *
   * Returns '' for any URL that fails validation; never throws.
   */
  sanitizeEvidenceUrl(url: string): string {
    if (!url || typeof url !== 'string') {
      return '';
    }

    try {
      const parsed = new URL(url);

      // Only allow HTTPS (blocks file://, http://, ftp://, etc.)
      if (parsed.protocol !== 'https:') {
        return '';
      }

      const hostname = parsed.hostname.toLowerCase();

      // Block private/reserved IP ranges (SSRF prevention)
      if (this.isPrivateHost(hostname)) {
        return '';
      }

      // Check against allowed gateway domains
      const isAllowed =
        this.allowedDomains.has(hostname) ||
        hostname.endsWith('.ipfs.dweb.link') ||
        hostname.endsWith('.ipfs.hashlock.dev');

      if (!isAllowed) {
        return '';
      }

      return parsed.toString();
    } catch {
      return '';
    }
  }

  /**
   * Sanitize any string input with basic XSS protection
   */
  sanitizeString(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    let sanitized = input;

    for (const pattern of this.xssPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }

    return this.encodeHtmlEntities(sanitized).trim();
  }

  /**
   * Validate and sanitize amount string
   */
  sanitizeAmount(amount: string): string {
    if (!amount || typeof amount !== 'string') {
      return '0';
    }

    // Remove any non-numeric characters except decimal point
    const sanitized = amount.replace(/[^\d.]/g, '');
    
    // Validate it's a valid number
    const num = parseFloat(sanitized);
    if (isNaN(num) || num < 0) {
      return '0';
    }

    return num.toString();
  }
}
