import {
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface JwtPayload {
  sub?: string;
  role?: string;
  roles?: string[];
  [key: string]: unknown;
}

interface AdminRequest extends Request {
  user?: JwtPayload;
}

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const user = req.user;
    const isAdmin =
      user?.role === 'admin' ||
      (Array.isArray(user?.roles) && user.roles.includes('admin'));
    if (!isAdmin) {
      throw new ForbiddenException('Admin role required');
    }
    return true;
  }
}

export interface AdminAuditLogRow {
  id: string;
  actor: string;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditQueryFilters {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class AuditService {
  // Append-only in-memory store; rows are never mutated or removed.
  private readonly rows: AdminAuditLogRow[] = [];
  private sequence = 0;

  async record(entry: {
    actor: string;
    action: string;
    target?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AdminAuditLogRow> {
    this.sequence += 1;
    const row: AdminAuditLogRow = {
      id: `audit_${this.sequence}`,
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      metadata: entry.metadata ?? null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  private filter(filters: AuditQueryFilters): AdminAuditLogRow[] {
    const from = filters.from ? new Date(filters.from).getTime() : undefined;
    const to = filters.to ? new Date(filters.to).getTime() : undefined;
    return this.rows.filter((row) => {
      if (filters.actor && row.actor !== filters.actor) return false;
      if (filters.action && row.action !== filters.action) return false;
      const ts = row.createdAt.getTime();
      if (from !== undefined && ts < from) return false;
      if (to !== undefined && ts > to) return false;
      return true;
    });
  }

  async list(filters: AuditQueryFilters): Promise<{
    items: AdminAuditLogRow[];
    nextCursor: string | null;
  }> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const matched = this.filter(filters);
    const startIndex = filters.cursor
      ? matched.findIndex((row) => row.id === filters.cursor) + 1
      : 0;
    const slice = matched.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < matched.length;
    return {
      items: slice,
      nextCursor: hasMore && slice.length > 0 ? slice[slice.length - 1].id : null,
    };
  }

  async exportCsv(filters: AuditQueryFilters): Promise<AdminAuditLogRow[]> {
    return this.filter(filters);
  }
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

@Controller('admin')
@UseGuards(AdminRoleGuard)
export class AdminAuditController {
  constructor(private readonly auditService: AuditService) {}

  private actorOf(req: AdminRequest): string {
    return req.user?.sub ?? 'unknown';
  }

  @Get('audits')
  async listAudits(@Req() req: AdminRequest, @Query() query: AuditQueryFilters) {
    await this.auditService.record({
      actor: this.actorOf(req),
      action: 'admin.audits.read',
      metadata: { filters: query },
    });
    return this.auditService.list(query);
  }

  @Get('audits/export')
  async exportAudits(
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query() query: AuditQueryFilters,
  ): Promise<void> {
    await this.auditService.record({
      actor: this.actorOf(req),
      action: 'admin.audits.export',
      metadata: { filters: query },
    });
    const rows = await this.auditService.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="admin-audits.csv"');
    res.write('id,actor,action,target,createdAt\n');
    for (const row of rows) {
      res.write(
        [
          csvEscape(row.id),
          csvEscape(row.actor),
          csvEscape(row.action),
          csvEscape(row.target),
          csvEscape(row.createdAt.toISOString()),
        ].join(',') + '\n',
      );
    }
    res.end();
  }
}

@Module({
  controllers: [AdminAuditController],
  providers: [AdminRoleGuard, AuditService],
  exports: [AdminRoleGuard, AuditService],
})
export class AdminModule {}
