import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PolicyListFilters {
  holder?: string;
  status?: string;
  type?: string;
  tenantId?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginatedPolicies {
  data: any[];
  nextCursor: string | null;
  hasMore: boolean;
}

@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  private baseWhere(filters: PolicyListFilters) {
    const where: any = { deletedAt: null };
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.holder) where.holder = filters.holder;
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    return where;
  }

  async list(filters: PolicyListFilters): Promise<PaginatedPolicies> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const where = this.baseWhere(filters);

    const rows = await this.prisma.policy.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor, hasMore };
  }

  async findById(id: string, tenantId?: string) {
    const where: any = { id, deletedAt: null };
    if (tenantId) where.tenantId = tenantId;

    const policy = await this.prisma.policy.findFirst({ where });
    if (!policy) {
      throw new NotFoundException(`Policy ${id} not found`);
    }
    return policy;
  }

  async findClaims(id: string, tenantId?: string) {
    const policy = await this.findById(id, tenantId);

    const claims = await this.prisma.claim.findMany({
      where: { policyId: policy.id, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return claims.map((claim: any) => ({
      ...claim,
      statusBadge: this.statusBadge(claim.status),
    }));
  }

  private statusBadge(status?: string): string {
    switch (status) {
      case 'APPROVED':
        return 'success';
      case 'PENDING':
        return 'warning';
      case 'REJECTED':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}
