import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class ExperimentalAccessLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ExperimentalAccessLogInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, ip } = request;
    const userAgent = request.get('user-agent');
    const timestamp = new Date().toISOString();

    this.logger.log(`[experimental-endpoint] ${method} ${url}`, {
      caller_ip: ip,
      caller_user_agent: userAgent,
      timestamp,
    });

    return next.handle();
  }
}
