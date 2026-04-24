import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import type { Response } from 'express';
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
import { GraphqlAdminAuthGuard } from './graphql-admin-auth.guard';
import { GraphqlOperationGuardService } from './graphql-operation-guard.service';
import { GraphqlRateLimitGuard } from './graphql-rate-limit.guard';
import { GraphqlWalletAuthGuard } from './graphql-wallet-auth.guard';
import { PersistedQueryMiddleware } from './persisted-query.middleware';
import { PolicyResolver } from './policy.resolver';
import { VotePubSubService } from './vote-pubsub.service';
import type { GraphqlRequest } from './graphql.context';

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
        const allowIntrospection = !isProduction ||
          config.get<boolean>('GRAPHQL_INTROSPECTION_IN_PRODUCTION', false);
        const slowOperationMs = config.get<number>('GRAPHQL_SLOW_OPERATION_MS', 750);
        const maxDepth = config.get<number>('GRAPHQL_MAX_DEPTH', 8);
        const logger = new AppLoggerService(config);
        const operationGuard = new GraphqlOperationGuardService(config);
        const plugins = [
          createGraphqlSecurityPlugin(operationGuard, metrics, logger, slowOperationMs),
        ];

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
                // Auth is enforced per-subscription via GraphqlWalletAuthGuard.
                // Store connectionParams on context so guards can read the token.
                return { connectionParams: ctx.connectionParams };
              },
            },
          },
          context: ({
            req,
            res,
          }: {
            req: GraphqlRequest;
            res: Response;
          }) => ({ req, res }),
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
