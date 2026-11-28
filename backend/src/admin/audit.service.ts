import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Response } from 'express';

export interface AuditMeta {
  actor: string;
  action: string;
  payload: Prisma.InputJsonObject;
  ipAddress?: string;
}

export interface AuditFilters {
  cursor?: string;
  limit?: number;
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(meta: AuditMeta): Promise<void> {
    await this.prisma.adminAuditLog.create({ data: meta });
  }

  private buildWhere(filters: Omit<AuditFilters, 'cursor' | 'limit'>): Prisma.AdminAuditLogWhereInput {
    const { action, actor, from, to } = filters;
    return {
      ...(action && { action }),
      ...(actor && { actor }),
      ...(from || to
        ? {
            createdAt: {
              ...(from && { gte: new Date(from) }),
              ...(to && { lte: new Date(to) }),
            },
          }
        : {}),
    };
  }

  async findAll(filters: AuditFilters) {
    const { cursor, limit = 20, action, actor, from, to } = filters;
    const take = Math.min(limit, 100);

    const where = this.buildWhere({ action, actor, from, to });

    const items = await this.prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { items: page, nextCursor, hasMore };
  }

  async streamCsv(filters: Omit<AuditFilters, 'cursor' | 'limit'>, res: Response): Promise<void> {
    const where = this.buildWhere(filters);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
    res.write('id,actor,action,ipAddress,createdAt\n');

    const BATCH = 500;
    let lastId: string | undefined;
    let done = false;

    while (!done) {
      const rows = await this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: BATCH,
        ...(lastId && { cursor: { id: lastId }, skip: 1 }),
        select: { id: true, actor: true, action: true, ipAddress: true, createdAt: true },
      });

      for (const row of rows) {
        const ip = row.ipAddress ?? '';
        res.write(`${row.id},${row.actor},${row.action},${ip},${row.createdAt.toISOString()}\n`);
      }

      if (rows.length < BATCH) {
        done = true;
      } else {
        lastId = rows[rows.length - 1].id;
      }
    }

    res.end();
  }
}
