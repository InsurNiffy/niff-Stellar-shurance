import { Injectable, Scope } from '@nestjs/common';

/**
 * TenantContextService — REQUEST-scoped holder for the resolved tenant ID.
 *
 * Populated by TenantMiddleware from:
 *   1. `x-tenant-id` request header (white-label / API integrations)
 *   2. Subdomain: `<tenantId>.niffyinsur.com` → tenantId extracted from host
 *
 * In single-tenant mode (TENANT_RESOLUTION_ENABLED=false or env var absent)
 * the tenantId remains null and all repository helpers skip tenant filters,
 * preserving identical behaviour to pre-tenant code paths.
 *
 * Isolation level: LOGICAL only.
 * All tenants share the same database and contract. Row-level filtering is
 * applied in application code. Physical isolation (separate DB / contract per
 * tenant) requires a separate deployment. See docs/tenant-isolation.md.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private _tenantId: string | null = null;

  get tenantId(): string | null {
    return this._tenantId;
  }

  set tenantId(value: string | null) {
    this._tenantId = value;
  }
}
