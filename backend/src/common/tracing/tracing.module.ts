import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './request-id.middleware';
import { RequestIdService } from './request-id.service';

@Global()
@Module({
  providers: [RequestIdService],
  exports: [RequestIdService],
})
export class TracingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
