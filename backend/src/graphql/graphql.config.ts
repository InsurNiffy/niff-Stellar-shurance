import { Injectable, Logger } from '@nestjs/common';
import { GqlModuleOptions, GqlOptionsFactory } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLError } from 'graphql';
import depthLimit from 'graphql-depth-limit';
import { getComplexity, simpleEstimator, fieldExtensionsEstimator } from 'graphql-query-complexity';
import { Counter } from 'prom-client';

const DEFAULT_MAX_DEPTH = 7;
const DEFAULT_MAX_COMPLEXITY = 200;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const graphqlComplexityRejectedTotal = new Counter({
  name: 'graphql_complexity_rejected_total',
  help: 'Total number of GraphQL queries rejected for exceeding depth or complexity limits',
  labelNames: ['reason'] as const,
});

@Injectable()
export class GraphqlConfigService implements GqlOptionsFactory {
  private readonly logger = new Logger(GraphqlConfigService.name);

  createGqlOptions(): GqlModuleOptions {
    const maxDepth = readPositiveInt(process.env.GRAPHQL_MAX_DEPTH, DEFAULT_MAX_DEPTH);
    const maxComplexity = readPositiveInt(
      process.env.GRAPHQL_MAX_COMPLEXITY,
      DEFAULT_MAX_COMPLEXITY,
    );

    return {
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      playground: false,
      validationRules: [
        depthLimit(maxDepth, {}, (depths) => {
          const exceeded = Object.entries(depths).filter(([, depth]) => depth > maxDepth);
          if (exceeded.length > 0) {
            graphqlComplexityRejectedTotal.inc({ reason: 'depth' });
            this.logger.warn(
              `GraphQL query rejected: depth ${Math.max(...exceeded.map(([, d]) => d))} exceeds max ${maxDepth}`,
            );
          }
        }),
      ],
      plugins: [
        {
          requestDidStart: () => ({
            didResolveOperation: ({ request, document, schema }) => {
              const complexity = getComplexity({
                schema,
                query: document,
                variables: request.variables,
                estimators: [
                  fieldExtensionsEstimator(),
                  simpleEstimator({ defaultComplexity: 1 }),
                ],
              });

              if (complexity > maxComplexity) {
                graphqlComplexityRejectedTotal.inc({ reason: 'complexity' });
                this.logger.warn(
                  `GraphQL query rejected: complexity ${complexity} exceeds max ${maxComplexity}`,
                );
                throw new GraphQLError(
                  `Query is too complex: ${complexity}. Maximum allowed complexity: ${maxComplexity}`,
                  { extensions: { code: 'QUERY_TOO_COMPLEX' } },
                );
              }
            },
          }),
        },
      ],
    } as ApolloDriverConfig;
  }
}
