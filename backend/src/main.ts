import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import helmet from "helmet";
import { ConfigService } from "@nestjs/config";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware";
import type { Request, Response, NextFunction } from "express";

export function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix
  app.setGlobalPrefix("api");

  // Security — Helmet tuned for a JSON-only API (no HTML served)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"] },
      },
      hsts: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: false,
      },
      frameguard: { action: "deny" },
      dnsPrefetchControl: { allow: false },
      referrerPolicy: { policy: "no-referrer" },
      permittedCrossDomainPolicies: false,
      crossOriginEmbedderPolicy: false,
      // X-Powered-By is removed by helmet by default
    }),
  );
  // Permissions-Policy — helmet 7 does not include a built-in helper
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    next();
  });

  // CORS — admin UI gets its own restricted origin list
  const configService = app.get(ConfigService);
  const adminOrigins = parseOrigins(
    configService.get<string>("ADMIN_CORS_ORIGINS") ?? "",
  );
  const frontendOrigins = parseOrigins(
    configService.get<string>("FRONTEND_ORIGINS") ?? "",
  );

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server / same-origin
      const allowed = [...frontendOrigins, ...adminOrigins];
      if (allowed.includes(origin)) return cb(null, origin); // echo exact origin
      return cb(new Error("Not allowed by CORS"), false); // triggers 403
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With", "Idempotency-Key"],
    maxAge: 86400,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Middleware
  const requestCtx = app.get(RequestContextMiddleware);
  app.use(requestCtx.use.bind(requestCtx));

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle("NiffyInsure Backend")
    .setDescription("Stellar insurance API")
    .setVersion("0.1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "JWT-auth",
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  const port = configService.get<number>("PORT") || 3000;

  await app.listen(port, "0.0.0.0");
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/api`,
    "Bootstrap",
  );
  Logger.log(`📚 Swagger docs: http://localhost:${port}/docs`, "Bootstrap");
}
bootstrap();
