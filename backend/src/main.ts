// OpenTelemetry instrumentation MUST be imported before any other module
// so that auto-instrumentation patches are applied at load time.
import './tracing'

import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
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
import { EnvironmentVariables } from "./config/env.definitions";

export function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
  const configService = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
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
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  const port = configService.get<number>("PORT") || 3000;

  await app.listen(port, "0.0.0.0");
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/api`,
    "Bootstrap",
  );
  Logger.log(`📚 Swagger docs: http://localhost:${port}/docs`, "Bootstrap");
  const graphqlEnabled = configService.get<boolean>('GRAPHQL_ENABLED', true);
  if (graphqlEnabled) {
    const graphqlPath = configService.get<string>('GRAPHQL_PATH', '/graphql');
    Logger.log(
      `🧭 GraphQL endpoint: http://localhost:${port}/api${graphqlPath}`,
      'Bootstrap',
    );
  }
  Logger.log(
    `🌐 Network: ${networkConfig.network.toUpperCase()} | Contract: ${networkConfig.contractIds.niffyinsure || '(not set)'}`,
    "Bootstrap",
  );
}
bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  Logger.error(message, undefined, 'Bootstrap');
  process.exit(1);
});
