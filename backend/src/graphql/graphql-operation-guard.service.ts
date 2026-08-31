import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLError, type DocumentNode, type GraphQLSchema } from 'graphql';
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';
import { resolveGraphqlLimits } from './graphql-limits.util';

type Variables = Record<string, unknown>;

@Injectable()
export class GraphqlOperationGuardService {
  private readonly maxComplexity: number;

  constructor(config: ConfigService) {
    const limits = resolveGraphqlLimits(config);
    this.maxComplexity = limits.maxComplexity;
  }

  /** Depth is enforced by `graphql-depth-limit` validation rules; complexity here.
   *  `overrideMaxComplexity` is set by PersistedQueryMiddleware for pre-approved operations
   *  that carry an explicit per-operation complexity budget in the allowlist. */
  assertWithinLimits(
    document: DocumentNode,
    variables: Variables = {},
    schema?: GraphQLSchema,
    overrideMaxComplexity?: number,
  ): void {
    if (!schema) {
      return;
    }

    const limit = overrideMaxComplexity ?? this.maxComplexity;

    const complexity = getComplexity({
      schema,
      query: document,
      variables,
      estimators: [simpleEstimator({ defaultComplexity: 1 })],
    });

    if (complexity > limit) {
      throw new GraphQLError(
        `Query complexity ${complexity} exceeds the maximum allowed complexity of ${limit}.`,
        {
          extensions: {
            code: 'GRAPHQL_COMPLEXITY_LIMIT',
            limit: 'complexity',
            complexity,
            maxComplexity: limit,
            http: { status: 400 },
          },
        },
      );
    }
  }
}
