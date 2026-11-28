// OpenTelemetry instrumentation MUST be imported before any other module
// so that auto-instrumentation patches are applied at load time.
import './tracing'

import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger, VersioningType } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import helmet from "helmet";
import { ConfigService } from "@nestjs/config";
import { RequestContextMiddleware } from "./common/middleware/request-context.middleware";
import type { Request, Response, NextFunction } from "express";
import { loadNetworkConfig } from "./config/network.config";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { validateEnvironment } from "./config/env.validation";
import { MetricsService } from './metrics/metrics.service';
import { setRedisCacheMetricsService } from './redis/cache';
import { setRedisClientMetricsService } from './redis/client';
import { AppLoggerService } from "./common/logger/app-logger.service";
import { PrismaService } from "./prisma/prisma.service";
import { NotificationsService } from "./notifications/notifications.service";
import {
  NOTIFICATION_PREFERENCES_REPOSITORY,
  NotificationPreferencesRepository,
} from "./notifications/notification-preferences.repository";
import { createNotificationDeliveryProcessor } from "./notifications/notification-delivery.processor";
import { resolveUnsubscribeSecret } from "./notifications/unsubscribe";
import { startNotificationWorker } from "./notifications/notification-jobs.worker";
import { EnvironmentVariables } from "./config/env.definitions";
import { DeprecationHeadersInterceptor } from "./common/interceptors/deprecation-headers.interceptor";
import { V1SunsetInterceptor } from "./common/interceptors/v1-sunset.interceptor";
import { RejectUnversionedApiMiddleware } from "./common/middleware/reject-unversioned-api.middleware";
import { trace, context, SpanStatusCode } from "@opentelemetry/api";

export function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds the OpenAPI document from the running application. Exported so the
 * `openapi:generate` script can reuse the exact same configuration as the
 * runtime Swagger UI, keeping the committed spec in sync with the code.
 */
export function buildOpenApiDocument(app: Parameters<typeof SwaggerModule.createDocument>[0]) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle("NiffyInsure Backend")
    .setDescription("Stellar insurance API")
    .setVersion("0.1.0")
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "JWT-auth",
    )
    .addApiKey(
      {
        type: "apiKey",
        in: "header",
        name: "x-tenant-id",
        description:
          "Optional tenant identifier for white-label / multi-tenant deployments. " +
          "Omit in single-tenant mode. Value: 3–64 lowercase alphanumeric + hyphens.",
      },
      "tenant-id",
    )
    .build();
  return SwaggerModule.createDocument(app, swaggerConfig);
}

async function assertRpcPassphrase(networkConfig: ReturnType<typeof loadNetworkConfig>): Promise<void> {
  const startupLogger = new Logger('NetworkAssertion');
  try {
    const server = new SorobanRpc.Server(networkConfig.rpcUrl, {
      allowHttp: networkConfig.rpcUrl.startsWith('http://'),
    });
    const info = await server.getNetwork();
    if (info.passphrase !== networkConfig.networkPassphrase) {
      throw new Error(
        'RPC passphrase mismatch. Check SOROBAN_RPC_URL and STELLAR_NETWORK_PASSPHRASE.',
      );
    }
    startupLogger.log(`RPC passphrase verified for network: ${networkConfig.network}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('passphrase mismatch')) throw err;
    // RPC unreachable at startup — log warning but don't block (offline dev)
    startupLogger.warn(`Could not verify RPC passphrase because the RPC endpoint was unreachable: ${String(err)}`);
  }
}

/**
 * Wraps a Soroban RPC simulation call in a custom span so latency can be
 * attributed precisely in traces. The active context (and therefore the
 * trace ID) is inherited from the inbound HTTP request.
 */
export async function withSorobanSimulationSpan<T>(
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer('niffyinsure-soroban-rpc');
  return tracer.startActiveSpan(
    `soroban.rpc.simulateTransaction`,
    { attributes: { 'rpc.system': 'soroban', 'rpc.method': operation } },
    context.active(),
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

async function bootstrap() {
  validateEnvironment(process.env);

  // Validate and load network config before anything else — fail fast.
  const networkConfig = loadNetworkConfig();
  const startupLogger = new Logger('Bootstrap');
  startupLogger.log(
    `🌐 Active network: ${networkConfig.network.toUpperCase()} | ` +
      `RPC: ${networkConfig.rpcUrl}`,
  );

  await assertRpcPassphrase(networkConfig);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const appLogger = app.get(AppLoggerService);
  app.useLogger(appLogger);

  // Wire MetricsService into Redis standalone modules (lazy injection)
  const metricsService = app.get(MetricsService);
  setRedisCacheMetricsService(metricsService);
  setRedisClientMetricsService(metricsService);

  // Global prefix + URI versioning (/api/v1/...)
  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });

  // Reject unversioned API requests with 400 before routing.
  const rejectUnversioned = new RejectUnversionedApiMiddleware();
  app.use(rejectUnversioned.use.bind(rejectUnversioned));

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
  const configService = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  const adminOrigins = parseOrigins(
    configService.get<string>("ADMIN_CORS_ORIGINS") ?? "",
  );
  const frontendOrigins = parseOrigins(
    configService.get<string>("FRONTEND_ORIGINS") ?? "",
  );
  // CORS_ALLOWED_ORIGINS is the canonical env var for the combined allowlist.
  // When set it takes precedence; otherwise fall back to FRONTEND_ORIGINS + ADMIN_CORS_ORIGINS.
  const corsAllowedOriginsRaw = configService.get<string>("CORS_ALLOWED_ORIGINS");
  const allowedOrigins = corsAllowedOriginsRaw
    ? parseOrigins(corsAllowedOriginsRaw)
    : [...frontendOrigins, ...adminOrigins];

  const isProduction = configService.get<string>("NODE_ENV") === "production";

  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean | string) => void) => {
      if (!origin) return cb(null, true); // server-to-server / same-origin
      // Reject wildcard in production
      if (isProduction && allowedOrigins.includes("*")) {
        return cb(new Error("Wildcard origin not allowed in production"), false);
      }
      if (allowedOrigins.includes(origin)) return cb(null, origin); // echo exact origin
      return cb(new Error("Not allowed by CORS"), false); // triggers 403
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With", "Idempotency-Key", "X-Tenant-Id"],
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

  // Deprecation headers — announce sunset dates on deprecated routes.
  app.useGlobalInterceptors(
    new DeprecationHeadersInterceptor(),
    new V1SunsetInterceptor(),
  );

  // Exception filter + response transform interceptor
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  // Graceful shutdown — let Nest close DB/Redis/workers on SIGTERM/SIGINT
  app.enableShutdownHooks();

  // Swagger — UI is disabled in production (spec is still generated for tooling).
  const document = buildOpenApiDocument(app);
  if (!isProduction) {
    SwaggerModule.setup("docs", app, document);
  }

  const port = configService.get<number>("PORT") || 3000;

  await app.listen(port, "0.0.0.0");
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/api/v1`,
    "Bootstrap",
  );
  if (!isProduction) {
    Logger.log(
      `📚 Swagger docs available at: http://localhost:${port}/docs`,
      "Bootstrap",
    );
  }
}

bootstrap().catch((err) => {
  Logger.error(
    `Fatal error during bootstrap: ${err instanceof Error ? err.stack : String(err)}`,
    "Bootstrap",
  );
  process.exit(1);
});
