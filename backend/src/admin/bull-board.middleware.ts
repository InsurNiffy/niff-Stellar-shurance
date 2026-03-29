import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { QueueMonitorService } from '../queues/queue-monitor.service';

@Injectable()
export class BullBoardMiddleware implements NestMiddleware {
  private readonly boardRouter: ReturnType<typeof ExpressAdapter.prototype.getRouter>;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly queueMonitor: QueueMonitorService,
  ) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
      queues: queueMonitor.getQueues().map((q) => new BullMQAdapter(q)),
      serverAdapter,
    });

    this.boardRouter = serverAdapter.getRouter();
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Enforce JWT + admin role before serving any Bull Board asset
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const token = authHeader.slice(7);
      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = this.jwtService.verify<{ role?: string }>(token, { secret });
      if (payload.role !== 'admin') {
        throw new ForbiddenException('Admin role required');
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Hand off to Bull Board's own Express router
    this.boardRouter(req, res, next);
  }
}
