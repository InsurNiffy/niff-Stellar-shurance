import { Injectable, Logger } from '@nestjs/common';

/**
 * Helper that injects the active tenant filter into Prisma query arguments.
 *
 * Every Prisma query executed on behalf of a tenant MUST be scoped with
 * `WHERE tenantId = :id`. This helper centralises that scoping so call sites
 * cannot accidentally omit the filter and leak cross-tenant data.
 */
@Injectable()
export class TenantFilterHelper {
  private readonly logger = new Logger(TenantFilterHelper.name);

  /**
   * Returns Prisma `where` arguments scoped to the given tenant.
   *
   * @param tenantId The active tenant id (from TenantContextService).
   * @param where    Optional additional where conditions to merge.
   */
  scope<T extends Record<string, unknown>>(
    tenantId: string,
    where: T = {} as T,
  ): T & { tenantId: string } {
    if (!tenantId) {
      throw new Error(
        'TenantFilterHelper.scope requires a tenantId; refusing to run an unscoped query',
      );
    }
    return { ...where, tenantId };
  }

  /**
   * Wraps Prisma query arguments, injecting the tenant filter into `where`.
   * Use for findMany / findFirst / findUnique / count / updateMany / deleteMany.
   */
  withTenant<
    A extends { where?: Record<string, unknown> },
  >(tenantId: string, args: A = {} as A): A & { where: Record<string, unknown> } {
    return {
      ...args,
      where: this.scope(tenantId, args.where ?? {}),
    };
  }

  /**
   * Wraps Prisma create arguments, injecting the tenant id into `data`.
   */
  withTenantData<
    A extends { data?: Record<string, unknown> },
  >(tenantId: string, args: A = {} as A): A & { data: Record<string, unknown> } {
    if (!tenantId) {
      throw new Error(
        'TenantFilterHelper.withTenantData requires a tenantId; refusing to write an unscoped record',
      );
    }
    return {
      ...args,
      data: { ...(args.data ?? {}), tenantId },
    };
  }
}
