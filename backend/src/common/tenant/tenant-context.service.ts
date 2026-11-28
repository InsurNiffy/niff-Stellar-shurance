import { Injectable, Scope, Inject } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Prisma } from '@prisma/client';

export const TENANT_HEADER = 'x-tenant-id';

export interface TenantRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  user?: { tenantId?: string; tenant_id?: string; [key: string]: unknown };
  tenantId?: string;
}

/**
 * Resolves the active tenant for the current request.
 *
 * Resolution order:
 *   1. JWT payload (`user.tenantId` / `user.tenant_id`) — authoritative.
 *   2. `x-tenant-id` request header — fallback for service-to-service calls.
 *
 * The service is request-scoped so that every consumer sees the tenant of the
 * request it is handling. When no tenant can be resolved, `getTenantId()`
 * throws so that unscoped queries can never silently run.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(@Inject(REQUEST) private readonly request: TenantRequestLike = {}) {}

  /**
   * Returns the active tenant id or `null` when none is present.
   */
  getTenantIdOrNull(): string | null {
    const fromJwt = this.request?.user?.tenantId ?? this.request?.user?.tenant_id;
    if (typeof fromJwt === 'string' && fromJwt.trim().length > 0) {
      return fromJwt.trim();
    }

    const rawHeader = this.request?.headers?.[TENANT_HEADER];
    const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof header === 'string' && header.trim().length > 0) {
      return header.trim();
    }

    if (typeof this.request?.tenantId === 'string' && this.request.tenantId.trim().length > 0) {
      return this.request.tenantId.trim();
    }

    return null;
  }

  /**
   * Returns the active tenant id, throwing when it cannot be resolved.
   */
  getTenantId(): string {
    const tenantId = this.getTenantIdOrNull();
    if (!tenantId) {
      throw new Error(
        'TenantContextService: no tenant id found on request (JWT or x-tenant-id header)',
      );
    }
    return tenantId;
  }

  /**
   * Builds a Prisma `where` fragment scoped to the active tenant.
   *
   * Usage:
   *   prisma.invoice.findMany({ where: tenantFilterHelper.scope({ status: 'OPEN' }) })
   */
  scope<T extends Record<string, unknown>>(where: T = {} as T): T & { tenantId: string } {
    return { ...where, tenantId: this.getTenantId() };
  }

  /**
   * Returns a Prisma `where` fragment scoped to the active tenant, or `null`
   * when no tenant is present. Callers must treat `null` as "return empty".
   */
  scopeOrNull<T extends Record<string, unknown>>(where: T = {} as T): (T & { tenantId: string }) | null {
    const tenantId = this.getTenantIdOrNull();
    if (!tenantId) {
      return null;
    }
    return { ...where, tenantId };
  }
}

/**
 * Helper that adds `WHERE tenantId = :id` to Prisma queries.
 *
 * Every read/write against a tenant-owned model must go through one of these
 * helpers so that cross-tenant data can never be returned. When the tenant is
 * missing, read helpers return an empty result instead of throwing a 403 —
 * cross-tenant queries must yield empty results, not authorization errors.
 */
export class TenantFilterHelper {
  constructor(private readonly tenantContext: TenantContextService) {}

  /**
   * Adds the tenant filter to a Prisma `where` clause.
   */
  where<T extends Record<string, unknown>>(where: T = {} as T): T & { tenantId: string } {
    return this.tenantContext.scope(where);
  }

  /**
   * Returns a tenant-scoped `where` clause, or `null` when no tenant is active.
   */
  whereOrNull<T extends Record<string, unknown>>(
    where: T = {} as T,
  ): (T & { tenantId: string }) | null {
    return this.tenantContext.scopeOrNull(where);
  }

  /**
   * Wraps a Prisma `findMany` call so that it is always tenant-scoped.
   * Returns `[]` when no tenant is active.
   */
  async findMany<T>(
    delegate: { findMany: (args: { where: Record<string, unknown> }) => Promise<T[]> },
    where: Record<string, unknown> = {},
  ): Promise<T[]> {
    const scoped = this.whereOrNull(where);
    if (!scoped) {
      return [];
    }
    return delegate.findMany({ where: scoped });
  }

  /**
   * Wraps a Prisma `findFirst` call so that it is always tenant-scoped.
   * Returns `null` when no tenant is active.
   */
  async findFirst<T>(
    delegate: { findFirst: (args: { where: Record<string, unknown> }) => Promise<T | null> },
    where: Record<string, unknown> = {},
  ): Promise<T | null> {
    const scoped = this.whereOrNull(where);
    if (!scoped) {
      return null;
    }
    return delegate.findFirst({ where: scoped });
  }

  /**
   * Wraps a Prisma `count` call so that it is always tenant-scoped.
   * Returns `0` when no tenant is active.
   */
  async count(
    delegate: { count: (args: { where: Record<string, unknown> }) => Promise<number> },
    where: Record<string, unknown> = {},
  ): Promise<number> {
    const scoped = this.whereOrNull(where);
    if (!scoped) {
      return 0;
    }
    return delegate.count({ where: scoped });
  }

  /**
   * Adds the tenant filter to a Prisma `data` payload for creates.
   */
  data<T extends Record<string, unknown>>(data: T): T & { tenantId: string } {
    return { ...data, tenantId: this.tenantContext.getTenantId() };
  }

  /**
   * Builds a Prisma `where` fragment for a unique lookup scoped to the tenant.
   */
  unique<T extends Record<string, unknown>>(where: T): T & { tenantId: string } {
    return this.tenantContext.scope(where);
  }
}

export type TenantScopedWhere = Prisma.Args<unknown, 'findMany'>['where'];
