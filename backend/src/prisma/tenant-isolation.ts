/**
 * Tenant isolation guard (issue #1632).
 *
 * Throws when a read/update/delete on a tenant-scoped model runs without a
 * `tenantId` in its `where` clause, so cross-tenant data cannot be read.
 */
export const TENANT_SCOPED_MODELS = new Set(['Claim', 'Policy', 'WebhookSubscription']);

const GUARDED_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

export function assertTenantScoped(
  model: string | undefined,
  operation: string,
  args: { where?: Record<string, unknown> } | undefined,
): void {
  if (!model || !TENANT_SCOPED_MODELS.has(model) || !GUARDED_OPERATIONS.has(operation)) return;
  const tenantId = args?.where?.tenantId;
  if (tenantId === undefined || tenantId === null) {
    throw new Error(`Tenant isolation violation: ${model}.${operation} requires a tenantId filter`);
  }
}
