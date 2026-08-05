import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../tenant/tenant-context.service';
import { claimTenantWhere } from '../tenant/tenant-filter.helper';

export interface ClaimsExportParams {
  status?: string;
  from?: string;
  to?: string;
}

/**
 * CSV headers for claim export. Column order matters for consistency.
 */
const CSV_HEADERS = [
  'id',
  'policyId',
  'creatorAddress',
  'amount',
  'asset',
  'description',
  'status',
  'severity',
  'isFinalized',
  'approveVotes',
  'rejectVotes',
  'paidAt',
  'createdAt',
  'updatedAt',
  'txHash',
  'tenantId',
];

@Injectable()
export class AdminClaimsExportService {
  private readonly logger = new Logger(AdminClaimsExportService.name);
  private readonly pageSize = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  /**
   * Creates a readable stream of CSV data for all claims matching the filters.
   * Uses cursor pagination internally to avoid loading all rows into memory.
   * CSV headers are included as the first row.
   */
  createClaimsExportStream(params: ClaimsExportParams): Readable {
    const readable = new Readable();

    this.streamClaimsAsCSV(readable, params)
      .catch((err) => {
        this.logger.error('Error streaming claims export', { err });
        readable.destroy(err);
      });

    return readable;
  }

  private async streamClaimsAsCSV(
    writable: Readable,
    params: ClaimsExportParams,
  ): Promise<void> {
    let cursor: number | undefined;
    let hasMore = true;

    // Write CSV header
    writable.push(this.arrayToCSVRow(CSV_HEADERS) + '\n');

    while (hasMore) {
      const where = this.buildWhereClause(params);
      const claims = await this.prisma.claim.findMany({
        where,
        orderBy: [{ id: 'asc' }],
        take: this.pageSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        select: {
          id: true,
          policyId: true,
          creatorAddress: true,
          amount: true,
          asset: true,
          description: true,
          status: true,
          severity: true,
          isFinalized: true,
          approveVotes: true,
          rejectVotes: true,
          paidAt: true,
          createdAt: true,
          updatedAt: true,
          txHash: true,
          tenantId: true,
        },
      });

      if (claims.length === 0) {
        hasMore = false;
        writable.push(null);
        return;
      }

      for (const claim of claims) {
        const row = [
          claim.id.toString(),
          claim.policyId,
          claim.creatorAddress,
          claim.amount,
          claim.asset ?? '',
          claim.description ?? '',
          claim.status,
          claim.severity ?? '',
          claim.isFinalized ? 'true' : 'false',
          claim.approveVotes.toString(),
          claim.rejectVotes.toString(),
          claim.paidAt ? claim.paidAt.toISOString() : '',
          claim.createdAt.toISOString(),
          claim.updatedAt.toISOString(),
          claim.txHash ?? '',
          claim.tenantId ?? '',
        ];
        writable.push(this.arrayToCSVRow(row) + '\n');
      }

      if (claims.length < this.pageSize) {
        hasMore = false;
        writable.push(null);
      } else {
        cursor = claims[claims.length - 1].id;
      }
    }
  }

  private buildWhereClause(params: ClaimsExportParams): Prisma.ClaimWhereInput {
    const tenantId = this.tenantCtx.tenantId;
    const where = claimTenantWhere(tenantId, {});

    if (params.status) {
      where.status = params.status.toUpperCase() as Prisma.ClaimWhereInput['status'];
    }

    if (params.from || params.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (params.from) {
        createdAt.gte = new Date(params.from);
      }
      if (params.to) {
        createdAt.lte = new Date(params.to);
      }
      where.createdAt = createdAt;
    }

    return where;
  }

  private arrayToCSVRow(values: string[]): string {
    return values.map((v) => this.escapeCSVField(v)).join(',');
  }

  private escapeCSVField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
