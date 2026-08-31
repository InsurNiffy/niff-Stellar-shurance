import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TenantConfigAuditEntry {
  id: string;
  tenantId: string;
  actor: string;
  key: string;
  oldValue: string | null;
  newValue: string;
  createdAt: Date;
}

@Injectable()
export class TenantConfigAuditService {
  private readonly logger = new Logger(TenantConfigAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a tenant config change in the audit log.
   * Both oldValue and newValue are JSON-serialized for consistency.
   */
  async recordConfigChange(opts: {
    tenantId: string;
    actor: string;
    key: string;
    oldValue: unknown;
    newValue: unknown;
  }): Promise<TenantConfigAuditEntry> {
    const { tenantId, actor, key, oldValue, newValue } = opts;

    try {
      const entry = await this.prisma.tenantConfigAuditLog.create({
        data: {
          tenantId,
          actor,
          key,
          oldValue: oldValue !== undefined ? JSON.stringify(oldValue) : null,
          newValue: JSON.stringify(newValue),
        },
      });

      this.logger.debug(
        `Config change recorded: tenant=${tenantId} key=${key} actor=${actor}`,
      );

      return entry;
    } catch (err) {
      this.logger.error(
        `Failed to record config change: tenant=${tenantId} key=${key}`,
        err,
      );
      throw err;
    }
  }

  /**
   * Retrieve audit history for a tenant's config changes.
   * Returns entries in chronological order (oldest first).
   */
  async getAuditHistory(opts: {
    tenantId: string;
    key?: string;
    actor?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: TenantConfigAuditEntry[]; total: number }> {
    const { tenantId, key, actor, limit = 50, offset = 0 } = opts;

    const where = {
      tenantId,
      ...(key && { key }),
      ...(actor && { actor }),
    };

    const [entries, total] = await Promise.all([
      this.prisma.tenantConfigAuditLog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.tenantConfigAuditLog.count({ where }),
    ]);

    return { entries, total };
  }

  /**
   * Retrieve the change history for a specific config key.
   */
  async getKeyHistory(
    tenantId: string,
    key: string,
  ): Promise<TenantConfigAuditEntry[]> {
    return this.prisma.tenantConfigAuditLog.findMany({
      where: { tenantId, key },
      orderBy: { createdAt: 'asc' },
    });
  }
}
