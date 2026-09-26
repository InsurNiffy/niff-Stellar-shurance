import { Injectable, NestMiddleware, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { isIPv4, isIPv6 } from 'net';

interface CidrRule {
  network: bigint;
  mask: bigint;
  family: 4 | 6;
}

@Injectable()
export class AllowlistMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AllowlistMiddleware.name);
  private readonly rules: CidrRule[] = [];
  private readonly isEmpty: boolean;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>('ADMIN_ALLOWED_CIDRS') ?? '';
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const part of parts) {
      const rule = parseCidr(part);
      if (rule) {
        this.rules.push(rule);
      } else {
        this.logger.warn(`Invalid CIDR in ADMIN_ALLOWED_CIDRS: "${part}" — skipping`);
      }
    }

    this.isEmpty = this.rules.length === 0;
    if (this.isEmpty) {
      this.logger.warn(
        'ADMIN_ALLOWED_CIDRS is empty/unset — all IPs are allowed. ' +
        'Set this variable to restrict admin endpoints to trusted CIDR ranges.',
      );
    }
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (this.isEmpty) {
      next();
      return;
    }

    const clientIp = getClientIp(req);
    const allowed = this.rules.some((rule) => ipMatchesCidr(clientIp, rule));

    if (!allowed) {
      this.logger.warn(`Admin access denied for IP: ${clientIp}`);
      throw new ForbiddenException('Access denied');
    }

    next();
  }
}

/**
 * Extract the client IP from a request, respecting X-Forwarded-For.
 */
function getClientIp(req: Request): string {
  const forwarded = req.get('X-Forwarded-For');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Parse a CIDR notation string into a rule object.
 * Supports both IPv4 (e.g. "10.0.0.0/8") and IPv6 (e.g. "2001:db8::/32").
 */
function parseCidr(input: string): CidrRule | null {
  const parts = input.split('/');
  const addr = parts[0];
  const prefixBits = parts[1] ? parseInt(parts[1], 10) : null;

  if (isIPv4(addr)) {
    const bits = prefixBits ?? 32;
    if (bits < 0 || bits > 32) return null;
    const ipInt = ipv4ToBigInt(addr);
    const mask = bits === 0 ? BigInt(0) : (BigInt(1) << BigInt(32)) - (BigInt(1) << BigInt(32 - bits));
    return { network: ipInt & mask, mask, family: 4 };
  }

  if (isIPv6(addr)) {
    const bits = prefixBits ?? 128;
    if (bits < 0 || bits > 128) return null;
    const ipBig = ipv6ToBigInt(addr);
    const mask = bits === 0 ? BigInt(0) : (BigInt(1) << BigInt(128)) - (BigInt(1) << BigInt(128 - bits));
    return { network: ipBig & mask, mask, family: 6 };
  }

  return null;
}

/**
 * Check whether an IP string falls within a CIDR rule.
 * Handles IPv4-mapped IPv6 addresses (e.g. ::ffff:10.0.0.1).
 */
function ipMatchesCidr(ip: string, rule: CidrRule): boolean {
  if (isIPv4(ip)) {
    if (rule.family === 6) return false; // different families
    const ipInt = ipv4ToBigInt(ip);
    return (ipInt & rule.mask) === rule.network;
  }

  if (isIPv6(ip)) {
    if (rule.family === 4) {
      // Check if the IPv6 address is an IPv4-mapped address
      const mapped = extractV4FromMappedV6(ip);
      if (mapped) {
        const ipInt = ipv4ToBigInt(mapped);
        return (ipInt & rule.mask) === rule.network;
      }
      return false;
    }
    const ipBig = ipv6ToBigInt(ip);
    return (ipBig & rule.mask) === rule.network;
  }

  return false;
}

function ipv4ToBigInt(ip: string): bigint {
  const octets = ip.split('.').map((o) => parseInt(o, 10));
  return BigInt(octets[0]) << BigInt(24) |
         BigInt(octets[1]) << BigInt(16) |
         BigInt(octets[2]) << BigInt(8) |
         BigInt(octets[3]);
}

function ipv6ToBigInt(ip: string): bigint {
  const hextets = expandV6(ip);
  let result = BigInt(0);
  for (const h of hextets) {
    result = (result << BigInt(16)) | BigInt(parseInt(h, 16));
  }
  return result;
}

/**
 * Expand an IPv6 address into 8 hextets, handling :: compression.
 */
function expandV6(ip: string): string[] {
  const lower = ip.toLowerCase();
  const parts = lower.split('::');

  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
    const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
    const fill = 8 - left.length - right.length;
    return [...left, ...new Array(fill).fill('0'), ...right];
  }

  return lower.split(':').filter(Boolean);
}

/**
 * If an IPv6 address is an IPv4-mapped IPv6 address (::ffff:x.x.x.x),
 * extract and return the embedded IPv4 string. Otherwise return null.
 */
function extractV4FromMappedV6(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (!lower.startsWith('::ffff:')) return null;
  const candidate = lower.slice(7); // strip "::ffff:"
  if (isIPv4(candidate)) return candidate;
  return null;
}
