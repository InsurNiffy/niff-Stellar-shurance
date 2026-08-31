import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import depthLimit from 'graphql-depth-limit';
import { join } from 'path';
import { AuthModule } from '../auth/auth.module';
import { CacheModule } from '../cache/cache.module';
import { ClaimsModule } from '../claims/claims.module';
import { AppLoggerService } from '../common/logger/app-logger.service';
import { MetricsModule } from '../metrics/metrics.module';
import { MetricsService } from '../metrics/metrics.service';
import { PolicyModule } from '../policy/policy.module';
import { ClaimResolver } from './claim.resolver';
import { createGraphqlSecurityPlugin, formatGraphqlError } from './graphql-apollo.plugins';
import { resolveGraphqlLimits } from './graphql-limits.util';
import { GraphqlAdminAuthGuard } from './graphql-admin-auth.guard';
import { GraphqlOperationGuardService } from './graphql-operation-guard.service';
import { GraphqlRateLimitGuard } from './graphql-rate-limit.guard';
import { GraphqlWalletAuthGuard } from './graphql-wallet-auth.guard';
import { PersistedQueryMiddleware } from './persisted-query.middleware';
import { PolicyResolver } from './policy.resolver';
import { VotePubSubService } from './vote-pubsub.service';
import type { GraphqlRequest } from './graphql.context';

export function authorizationFromConnectionParams(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') {
    return undefined;
  }

  const record = params as Record<string, unknown>;
  const value = record.Authorization ?? record.authorization;
  return typeof value === 'string' ? value : undefined;
}

export function assertWalletJwt(config: ConfigService, authorization?: string): void {
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Wallet authentication is required');
  }

  try {
    const token = authorization.slice('Bearer '.length).trim();
    const payload = jwt.verify(token, config.get<string>('JWT_SECRET') ?? '') as Record<
      string,
      unknown
    >;
    if (typeof payload.walletAddress === 'string' && payload.walletAddress.length > 0) {
      return;
    }
  } catch {
    // Normalise JWT parse/expiry/signature failures for the WebSocket handshake.
  }
  throw new Error('Wallet authentication is required');
}

@Module({
  imports: [
    AuthModule,
    CacheModule,
    ClaimsModule,
    ConfigModule,
    MetricsModule,
    PolicyModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule, MetricsModule],
      inject: [ConfigService, MetricsService],
      useFactory: (
        config: ConfigService,
        metrics: MetricsService,
      ) => {
        const isProduction = config.get<string>('NODE_ENV') === 'production';
        const graphqlEnabled = config.get<boolean>('GRAPHQL_ENABLED', true);
        const graphqlPath = graphqlEnabled
          ? config.get<string>('GRAPHQL_PATH', '/graphql')
          : '/__graphql_disabled__';
        // Disable introspection in production by default. Non-production environments
        // enable introspection for developer experience (schema exploration, testing).
        const allowIntrospection = !isProduction;
        const slowOperationMs = config.get<number>('GRAPHQL_SLOW_OPERATION_MS', 750);
        const { maxDepth } = resolveGraphqlLimits(config);
        const logger = new AppLoggerService(config);
        const operationGuard = new GraphqlOperationGuardService(config);
        const plugins = [
          createGraphqlSecurityPlugin(operationGuard, metrics, logger, slowOperationMs),
        ];

        // Enable landing page (Apollo Sandbox) only in non-production environments
        if (!isProduction) {
          plugins.push(ApolloServerPluginLandingPageLocalDefault());
        }

        return {
          autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql'),
          path: graphqlPath,
          sortSchema: true,
          useGlobalPrefix: true,
          debug: false,
          csrfPrevention: true,
          introspection: allowIntrospection,
          includeStacktraceInErrorResponses: false,
          subscriptions: {
            'graphql-ws': {
              path: graphqlPath,
              onConnect: async (ctx) => {
                const authorization = authorizationFromConnectionParams(ctx.connectionParams);
                assertWalletJwt(config, authorization);
                return { connectionParams: ctx.connectionParams };
              },
            },
          },
          context: (ctx: {
            req?: GraphqlRequest;
            res?: Response;
            connectionParams?: unknown;
            extra?: { request?: { headers?: Record<string, string | string[] | undefined> } };
          }) => {
            if (ctx.req) {
              return { req: ctx.req, res: ctx.res };
            }

            const authorization = authorizationFromConnectionParams(ctx.connectionParams);
            const req = {
              headers: {
                ...(ctx.extra?.request?.headers ?? {}),
                ...(authorization ? { authorization } : {}),
              },
            } as GraphqlRequest;
            return { req, res: undefined as unknown as Response };
          },
          plugins,
          validationRules: [depthLimit(maxDepth)],
          formatError: formatGraphqlError,
        };
      },
    }),
  ],
  providers: [
    ClaimResolver,
    PolicyResolver,
    GraphqlAdminAuthGuard,
    GraphqlOperationGuardService,
    GraphqlRateLimitGuard,
    GraphqlWalletAuthGuard,
    PersistedQueryMiddleware,
    VotePubSubService,
  ],
})
export class GraphqlApiModule implements NestModule {
  constructor(private readonly config: ConfigService) {}

  configure(consumer: MiddlewareConsumer): void {
    if (!this.config.get<boolean>('GRAPHQL_ENABLED', true)) {
      return;
    }

    const path = (this.config.get<string>('GRAPHQL_PATH', '/graphql') ?? '/graphql').replace(
      /^\//,
      '',
    );

    consumer.apply(PersistedQueryMiddleware).forRoutes({
      path,
      method: RequestMethod.POST,
    });
  }
}
