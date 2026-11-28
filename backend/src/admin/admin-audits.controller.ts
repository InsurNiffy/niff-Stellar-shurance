import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
  ForbiddenException,
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface AdminJwtPayload {
  sub?: string;
  role?: string;
  roles?: string[];
  [key: string]: unknown;
}

interface AdminRequest extends Request {
  user?: AdminJwtPayload;
}

function isAdmin(payload: AdminJwtPayload | undefined): boolean {
  if (!payload) return false;
  if (payload.role === 'admin') return true;
  if (Array.isArray(payload.roles) && payload.roles.includes('admin')) return true;
  return false;
}

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    if (!isAdmin(req.user)) {
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

export interface AuditQuery {
  actor?: string;
  action?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}

export interface AuditPage {
  items: AdminAuditLogRow[];
  nextCursor: string | null;
}

/**
 * Append-only audit log store. Rows are only ever inserted; there is no
 * update or delete path exposed by this service.
 */
@Injectable()
export class AuditService {
  private readonly rows: AdminAuditLogRow[] = [];

  async append(entry: Omit<AdminAuditLogRow, 'id' | 'createdAt'>): Promise<AdminAuditLogRow> {
    const row: AdminAuditLogRow = {
      ...entry,
      id: `${Date.now()}-${this.rows.length}`,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  private filter(query: AuditQuery): AdminAuditLogRow[] {
    return this.rows.filter((row) => {
      if (query.actor && row.actor !== query.actor) return false;
      if (query.action && row.action !== query.action) return false;
      if (query.from && row.createdAt < query.from) return false;
      if (query.to && row.createdAt > query.to) return false;
      return true;
    });
  }

  async list(query: AuditQuery): Promise<AuditPage> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const filtered = this.filter(query).sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });

    let start = 0;
    if (query.cursor) {
      const idx = filtered.findIndex((row) => row.id === query.cursor);
      if (idx === -1) {
        throw new BadRequestException('Invalid cursor');
      }
      start = idx + 1;
    }

    const items = filtered.slice(start, start + limit);
    const nextCursor = start + limit < filtered.length ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async *stream(query: AuditQuery): AsyncGenerator<AdminAuditLogRow> {
    const filtered = this.filter(query).sort((a, b) => {
      const diff = b.createdAt.getTime() - a.createdAt.getTime();
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    });
    for (const row of filtered) {
      yield row;
    }
  }
}

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Invalid ${field} date`);
  }
  return date;
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

@Controller('admin/audits')
@UseGuards(AdminRoleGuard)
export class AdminAuditsController {
  constructor(private readonly auditService: AuditService) {}

  private buildQuery(
    actor?: string,
    action?: string,
    from?: string,
    to?: string,
    cursor?: string,
    limit?: string,
  ): AuditQuery {
    return {
      actor,
      action,
      from: parseDate(from, 'from'),
      to: parseDate(to, 'to'),
      cursor,
      limit: limit ? Number(limit) : undefined,
    };
  }

  private async logAccess(req: AdminRequest, action: string): Promise<void> {
    await this.auditService.append({
      actor: req.user?.sub ?? 'unknown',
      action,
      target: 'admin_audit_logs',
      metadata: { path: req.path, query: req.query },
    });
  }

  @Get()
  async list(
    @Req() req: AdminRequest,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<AuditPage> {
    const query = this.buildQuery(actor, action, from, to, cursor, limit);
    const page = await this.auditService.list(query);
    await this.logAccess(req, 'admin.audits.read');
    return page;
  }

  @Get('export')
  async export(
    @Req() req: AdminRequest,
    @Res() res: Response,
    @Query('actor') actor?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const query = this.buildQuery(actor, action, from, to);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="admin-audits.csv"');
    res.write('id,actor,action,target,createdAt\n');

    for await (const row of this.auditService.stream(query)) {
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

    await this.logAccess(req, 'admin.audits.export');
    res.end();
  }
}
