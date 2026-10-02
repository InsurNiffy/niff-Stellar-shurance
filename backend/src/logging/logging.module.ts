import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { LoggingRequestIdMiddleware } from './request-id.middleware';

@Module({
  providers: [LoggingRequestIdMiddleware],
  exports: [LoggingRequestIdMiddleware],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggingRequestIdMiddleware).forRoutes('*');
  }
}
