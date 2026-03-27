import { Prisma } from '@prisma/client';

/**
 * Builds a Prisma `where` fragment that scopes a query to the given tenant.
 *
 * Behaviour:
 *   - tenantId = null  → single-tenant mode; no filter added (returns {})
 *   - tenantId = string → adds `{ tenantId: <value> }` to the where clause
 *
 * Usage:
 *   const where = { ...tenantFilter(tenantId), status: 'PENDING' }
 *
 * This helper is the single enforcement point for tenant isolation.
 * Every repository query on a tenant-scoped model MUST call this.
 */
export function tenantFilter(tenantId: string | null): { tenantId?: string } {
  if (!tenantId) return {};
  return { tenantId };
}

/**
 * Asserts that a retrieved record belongs to the expected tenant.
 * Throws if the record's tenantId does not match.
 *
 * Use this after `findUnique` / `findFirst` to prevent cross-tenant reads
 * when the primary key is known but the tenant is not part of the PK.
 *
 * @param record  - The fetched record (may be null)
 * @param tenantId - The expected tenant (null = single-tenant, skip check)
 * @param label   - Human-readable label for error messages (e.g. "Claim 42")
 */
export function assertTenantOwnership<T extends { tenantId?: string | null }>(
  record: T | null,
  tenantId: string | null,
  label: string,
): asserts record is T {
  if (!record) {
    // Let callers handle the null case (NotFoundException etc.)
    return;
  }
  if (!tenantId) {
    // Single-tenant mode — no ownership check needed
    return;
  }
  if (record.tenantId !== tenantId) {
    // Return 404 rather than 403 to avoid leaking existence of the resource
    throw new TenantOwnershipError(label);
  }
}

export class TenantOwnershipError extends Error {
  constructor(label: string) {
    super(`${label} not found`);
    this.name = 'TenantOwnershipError';
  }
}

/**
 * Builds a Prisma ClaimWhereInput scoped to the given tenant.
 * Merges with any additional where conditions provided.
 */
export function claimTenantWhere(
  tenantId: string | null,
  extra: Prisma.ClaimWhereInput = {},
): Prisma.ClaimWhereInput {
  return { ...tenantFilter(tenantId), ...extra };
}

/**
 * Builds a Prisma PolicyWhereInput scoped to the given tenant.
 */
export function policyTenantWhere(
  tenantId: string | null,
  extra: Prisma.PolicyWhereInput = {},
): Prisma.PolicyWhereInput {
  return { ...tenantFilter(tenantId), ...extra };
}
