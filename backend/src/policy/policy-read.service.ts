import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Policy } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaReplicaService } from '../prisma/prisma-replica.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { assertTenantOwnership, policyTenantWhere } from '../tenant/tenant-filter.helper';

export interface ListPoliciesParams {
  after?: string;
  first?: number;
  holderAddress?: string;
  active?: boolean;
  includeDeleted?: boolean;
}

export interface SearchPoliciesParams {
  holder?: string;
  type?: string;
  region?: string;
  active?: boolean;
  after?: string;
  first?: number;
}

export interface PolicyConnection {
  items: Policy[];
  nextCursor: string | null;
  total: number;
}

type PolicyCursor = {
  createdAt: string;
  id: string;
};

const DEFAULT_FIRST = 20;
const MAX_FIRST = 100;

function clampFirst(first?: number): number {
  return Math.min(Math.max(1, first ?? DEFAULT_FIRST), MAX_FIRST);
}

function encodePolicyCursor(policy: Pick<Policy, 'createdAt' | 'id'>): string {
  return Buffer.from(
    JSON.stringify({ createdAt: policy.createdAt.toISOString(), id: policy.id } satisfies PolicyCursor),
    'utf8',
  ).toString('base64url');
}

function decodePolicyCursor(cursor: string): PolicyCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as PolicyCursor;
    if (
      typeof decoded.createdAt !== 'string' ||
      typeof decoded.id !== 'string' ||
      Number.isNaN(Date.parse(decoded.createdAt))
    ) {
      throw new Error('invalid cursor');
    }

    return decoded;
  } catch {
    throw new BadRequestException(`Invalid policy cursor: "${cursor}"`);
  }
}

@Injectable()
export class PolicyReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaReplica: PrismaReplicaService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  /** Get the appropriate client for reads — replica if enabled, otherwise primary. */
  private getReadClient() {
    return this.prismaReplica.isEnabled() ? this.prismaReplica : this.prisma;
  }

  async listPolicies(params: ListPoliciesParams): Promise<PolicyConnection> {
    const first = clampFirst(params.first);
    const tenantId = this.tenantCtx.tenantId;
    const where = this.buildListWhere(params, tenantId);
    const readClient = this.getReadClient();

    const [items, total] = await Promise.all([
      readClient.policy.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: first,
      }),
      readClient.policy.count({ where }),
    ]);

    return {
      items,
      nextCursor:
        items.length > 0 && items.length === first && total > first
          ? encodePolicyCursor(items[items.length - 1])
          : null,
      total,
    };
  }

  async getPolicyById(id: string, includeDeleted = false): Promise<Policy> {
    const tenantId = this.tenantCtx.tenantId;
    const readClient = this.getReadClient();
    const policy = await readClient.policy.findUnique({ where: { id } });
    assertTenantOwnership(policy, tenantId, `Policy ${id}`);

    if (!policy || (!includeDeleted && policy.deletedAt)) {
      throw new NotFoundException(`Policy ${id} not found`);
    }

    return policy;
  }

  async getPoliciesByIds(ids: readonly string[], includeDeleted = false): Promise<Map<string, Policy>> {
    const tenantId = this.tenantCtx.tenantId;
    const uniqueIds = [...new Set(ids)];
    const readClient = this.getReadClient();
    const policies = await readClient.policy.findMany({
      where: policyTenantWhere(
        tenantId,
        {
          id: { in: uniqueIds },
        },
        { includeDeleted },
      ),
    });

    return new Map(policies.map((policy) => [policy.id, policy]));
  }

  async searchPolicies(params: SearchPoliciesParams): Promise<PolicyConnection> {
    const first = clampFirst(params.first);
    const tenantId = this.tenantCtx.tenantId;
    const readClient = this.getReadClient();

    const extra: Prisma.PolicyWhereInput = {};

    if (params.holder) {
      extra.holderAddress = { contains: params.holder, mode: 'insensitive' };
    }

    if (params.type) {
      extra.policyType = params.type;
    }

    if (params.region) {
      extra.region = params.region;
    }

    if (typeof params.active === 'boolean') {
      extra.isActive = params.active;
    }

    if (params.after) {
      const cursor = decodePolicyCursor(params.after);
      extra.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        {
          createdAt: { equals: new Date(cursor.createdAt) },
          id: { lt: cursor.id },
        },
      ];
    }

    const where = policyTenantWhere(tenantId, extra);

    const [items, total] = await Promise.all([
      readClient.policy.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: first,
      }),
      readClient.policy.count({ where }),
    ]);

    return {
      items,
      nextCursor:
        items.length > 0 && items.length === first && total > first
          ? encodePolicyCursor(items[items.length - 1])
          : null,
      total,
    };
  }

  private buildListWhere(
    params: ListPoliciesParams,
    tenantId: string | null,
  ): Prisma.PolicyWhereInput {
    const extra: Prisma.PolicyWhereInput = {};

    if (params.holderAddress) {
      extra.holderAddress = params.holderAddress;
    }

    if (typeof params.active === 'boolean') {
      extra.isActive = params.active;
    }

    if (params.after) {
      const cursor = decodePolicyCursor(params.after);
      extra.OR = [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        {
          createdAt: { equals: new Date(cursor.createdAt) },
          id: { lt: cursor.id },
        },
      ];
    }

    return policyTenantWhere(tenantId, extra, {
      includeDeleted: params.includeDeleted,
    });
  }
}
