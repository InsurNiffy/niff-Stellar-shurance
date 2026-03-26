import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditMeta {
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(meta: AuditMeta): Promise<void> {
    await this.prisma.adminAuditLog.create({ data: meta });
  }

  async findAll(page: number, limit: number, action?: string) {
    const where = action ? { action } : {};
    const [items, total] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return { items, total, page, limit };
  }
}
