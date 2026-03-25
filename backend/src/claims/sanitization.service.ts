import { Injectable } from '@nestjs/common';

@Injectable()
export class SanitizationService {
  // Allowed IPFS gateway domains
  private readonly allowedDomains = new Set([
    'ipfs.io',
    'cloudflare-ipfs.com',
    'gateway.pinata.cloud',
    'dweb.link',
    'nftstorage.link',
  ]);

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
   * Sanitize evidence URL - validate against allowed domains
   */
  sanitizeEvidenceUrl(url: string): string {
    if (!url || typeof url !== 'string') {
      return '';
    }

    try {
      const parsed = new URL(url);
      
      // Only allow HTTPS
      if (parsed.protocol !== 'https:') {
        return '';
      }

      // Check against allowed domains
      const hostname = parsed.hostname.toLowerCase();
      const isAllowed = this.allowedDomains.has(hostname) || 
        hostname.endsWith('.ipfs.dweb.link') ||
        hostname.endsWith('.ipfs.hashlock.dev');

      if (!isAllowed) {
        return '';
      }

      // Return sanitized URL
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
