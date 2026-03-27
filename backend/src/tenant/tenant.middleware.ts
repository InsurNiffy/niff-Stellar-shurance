import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContextService } from './tenant-context.service';

/**
 * TenantMiddleware
 *
 * Resolves the tenant for each request and stores it in the REQUEST-scoped
 * TenantContextService. Resolution order:
 *
 *   1. `x-tenant-id` header  (explicit — used by API integrations)
 *   2. Subdomain of the Host header: `<tenantId>.niffyinsur.com`
 *
 * When TENANT_RESOLUTION_ENABLED is not "true" (default), resolution is
 * skipped entirely and tenantId stays null — single-tenant mode.
 *
 * Tenant IDs are validated against a simple allowlist pattern:
 *   - 3–64 characters
 *   - lowercase alphanumeric + hyphens only
 *   - must not start or end with a hyphen
 * Invalid values are silently ignored (tenantId stays null).
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);
  private readonly enabled: boolean;
  private readonly baseDomain: string;

  constructor(private readonly tenantCtx: TenantContextService) {
    this.enabled = process.env.TENANT_RESOLUTION_ENABLED === 'true';
    this.baseDomain = process.env.TENANT_BASE_DOMAIN ?? 'niffyinsur.com';
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    if (!this.enabled) {
      return next();
    }

    const tenantId = this.resolveFromHeader(req) ?? this.resolveFromSubdomain(req);

    if (tenantId) {
      this.tenantCtx.tenantId = tenantId;
      this.logger.debug(`Resolved tenant: ${tenantId}`);
    }

    next();
  }

  private resolveFromHeader(req: Request): string | null {
    const raw = req.headers['x-tenant-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? this.validate(value.trim()) : null;
  }

  private resolveFromSubdomain(req: Request): string | null {
    const host = (req.headers['host'] ?? '').split(':')[0]; // strip port
    if (!host.endsWith(`.${this.baseDomain}`)) return null;
    const subdomain = host.slice(0, host.length - this.baseDomain.length - 1);
    return subdomain ? this.validate(subdomain) : null;
  }

  /** Returns the value if valid, null otherwise. */
  private validate(value: string): string | null {
    const TENANT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$|^[a-z0-9]{3}$/;
    return TENANT_ID_RE.test(value) ? value : null;
  }
}
