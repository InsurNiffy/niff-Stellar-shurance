import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Global prefix
  app.setGlobalPrefix('api');
  
  // Security
  app.use(helmet());

  // CORS — admin UI gets its own restricted origin list
  const configService = app.get(ConfigService);
  const adminOrigins = (configService.get<string>('ADMIN_CORS_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const publicOrigins = (configService.get<string>('CORS_ORIGINS') ?? '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / server-to-server
      const isAdmin = origin ? adminOrigins.some((o) => o === origin) : false;
      const isPublic = publicOrigins.includes('*') || publicOrigins.includes(origin ?? '');
      cb(null, isAdmin || isPublic);
    },
    credentials: true,
  });

  // Middleware
  app.use(LoggerMiddleware);
  
  // Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));
  
  // Exception filter
  app.useGlobalFilters(new HttpExceptionFilter());
  
  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('NiffyInsure Backend')
    .setDescription('Stellar insurance API')
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT-auth',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get<number>('PORT') || 3000;
  
  await app.listen(port, '0.0.0.0');
  Logger.log(`🚀 Application is running on: http://localhost:${port}/api`, 'Bootstrap');
  Logger.log(`📚 Swagger docs: http://localhost:${port}/docs`, 'Bootstrap');
}
bootstrap();

