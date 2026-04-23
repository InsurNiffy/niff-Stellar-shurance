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

export type SoftDeleteQueryOpts = {
  /** When true, include rows with `deletedAt` set (admin / compliance queries). */
  includeDeleted?: boolean;
};

/**
 * Builds a Prisma ClaimWhereInput scoped to the given tenant.
 * Merges with any additional where conditions provided.
 * By default excludes soft-deleted rows (`deletedAt` IS NULL).
 */
export function claimTenantWhere(
  tenantId: string | null,
  extra: Prisma.ClaimWhereInput = {},
  opts?: SoftDeleteQueryOpts,
): Prisma.ClaimWhereInput {
  const active = opts?.includeDeleted ? {} : { deletedAt: null };
  return { ...tenantFilter(tenantId), ...active, ...extra };
}

/**
 * Builds a Prisma PolicyWhereInput scoped to the given tenant.
 * By default excludes soft-deleted rows.
 */
export function policyTenantWhere(
  tenantId: string | null,
  extra: Prisma.PolicyWhereInput = {},
  opts?: SoftDeleteQueryOpts,
): Prisma.PolicyWhereInput {
  const active = opts?.includeDeleted ? {} : { deletedAt: null };
  return { ...tenantFilter(tenantId), ...active, ...extra };
}

/**
 * Builds a Prisma VoteWhereInput scoped transitively via the parent claim.
 * Votes themselves do not have a tenantId column; isolation is enforced
 * by joining through the claim relation.
 */
export function voteTenantWhere(
  tenantId: string | null,
  extra: Prisma.VoteWhereInput = {},
): Prisma.VoteWhereInput {
  if (!tenantId) return extra;
  // Transitively scope votes through their claim's tenantId
  return {
    claim: { tenantId },
    ...extra,
  };
}

// ── CI lint helpers ────────────────────────────────────────────────────────

/**
 * Known tenant-scoped Prisma model names that MUST be filtered by tenant.
 */
export const TENANT_SCOPED_MODELS = ['claim', 'policy'] as const;

/**
 * Checks whether a raw TypeScript code snippet contains a Prisma query
 * on a tenant-scoped model that does NOT use the tenant-filter helpers.
 *
 * This is a lightweight regex-based check intended for CI linting.
 * It will catch obvious bypasses but may miss sophisticated evasion.
 *
 * @param code - Source code to inspect (single file contents)
 * @returns Array of violation descriptions with line hints
 */
export function queryBypassesTenantFilter(code: string): string[] {
  const violations: string[] = [];
  const lines = code.split('\n');

  // Pattern: prisma.<model>.findMany/findFirst/findUnique({ where: { ... } })
  // where the where object does NOT contain claimTenantWhere / policyTenantWhere
  const queryRegex = /prisma\.(claim|policy)\.(findMany|findFirst|findUnique|count|update|updateMany|delete|deleteMany)\s*\(\s*\{/gi;

  let match: RegExpExecArray | null;
  while ((match = queryRegex.exec(code)) !== null) {
    const modelName = match[1].toLowerCase();
    const methodName = match[2];
    const startIndex = match.index;

    // Extract the line number
    const lineNumber = code.substring(0, startIndex).split('\n').length;

    // Look ahead for tenant-filter helper usage within the next 500 chars
    const lookahead = code.substring(startIndex, startIndex + 500);
    const hasTenantFilter =
      lookahead.includes('claimTenantWhere') ||
      lookahead.includes('policyTenantWhere') ||
      lookahead.includes('tenantFilter');

    if (!hasTenantFilter) {
      violations.push(
        `Line ${lineNumber}: ${modelName}.${methodName} query may bypass tenant filter ` +
        `(no claimTenantWhere / policyTenantWhere / tenantFilter detected in call)`,
      );
    }
  }

  return violations;
}
