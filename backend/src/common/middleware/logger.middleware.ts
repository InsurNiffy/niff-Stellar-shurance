import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createLogger, format, transports } from 'winston';
import { ConfigService } from '@nestjs/config';
import { redactHeaders, redactValue, redactMessageText } from '../logger/app-logger.service';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger: ReturnType<typeof createLogger>;

  constructor(private configService: ConfigService) {
    const logLevel = this.configService.get<string>('LOG_LEVEL', 'info');
    
    this.logger = createLogger({
      level: logLevel,
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        format.errors({ stack: true }),
        format.json(),
      ),
      defaultMeta: { service: 'niffyinsure-api' },
      transports: [
        new transports.Console({
          format: format.combine(
            format.colorize(),
            format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length
                ? ` ${JSON.stringify(redactValue(meta))}`
                : '';
              return `${timestamp} [${level}] ${redactMessageText(String(message))}${metaStr}`;
            }),
          ),
        }),
      ],
    });
  }

  private sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    return redactHeaders(headers);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = req.headers['x-request-id'] as string || this.generateRequestId();
    const start = Date.now();
    
    // Log incoming request
    this.logger.info('Incoming request', {
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.get('user-agent'),
      headers: this.sanitizeHeaders(req.headers as Record<string, unknown>),
    });

    // Capture response
    res.on('finish', () => {
      const duration = Date.now() - start;
      this.logger.info('Request completed', {
        requestId,
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('content-length') || 0,
      });
    });

    next();
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
