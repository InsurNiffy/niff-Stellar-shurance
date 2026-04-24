import type { ApolloServerPlugin } from '@apollo/server';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { AppLoggerService } from '../common/logger/app-logger.service';
import { MetricsService } from '../metrics/metrics.service';
import { GraphqlOperationGuardService } from './graphql-operation-guard.service';
import type { GraphqlContext } from './graphql.context';

export function createGraphqlSecurityPlugin(
  guard: GraphqlOperationGuardService,
  metrics: MetricsService,
  logger: AppLoggerService,
  slowOperationMs: number,
): ApolloServerPlugin<GraphqlContext> {
  return {
    async requestDidStart(requestContext) {
      const startedAt = Date.now();
      const requestId = requestContext.contextValue.req?.requestId;
      let hadErrors = false;

      return {
        async didResolveOperation(context) {
          guard.assertWithinLimits(context.document, context.request.variables);
        },
        async willSendResponse(context) {
          const durationMs = Date.now() - startedAt;
          const operationType = context.operation?.operation ?? 'unknown';
          const status = hadErrors || context.errors?.length ? 'error' : 'success';

          metrics.recordGraphqlOperation({
            operationType,
            status,
            durationMs,
          });

          if (durationMs >= slowOperationMs) {
            logger.structured('warn', 'graphql_slow_operation', {
              requestId,
              operationName: context.request.operationName ?? 'anonymous',
              operationType,
              durationMs,
            });
          }
        },
        async didEncounterErrors(context) {
          hadErrors = true;
          void context;
        },
      };
    },
  };
}

export function formatGraphqlError(
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const graphQLError = error instanceof GraphQLError ? error : undefined;
  const response =
    typeof graphQLError?.extensions?.response === 'object' &&
    graphQLError.extensions.response !== null
      ? (graphQLError.extensions.response as { statusCode?: number; message?: unknown })
      : undefined;
  const responseCode = response?.statusCode;
  const responseMessage =
    typeof response?.message === 'string'
      ? response.message
      : Array.isArray(response?.message)
        ? response.message.join(', ')
        : undefined;
  const code =
    typeof formattedError.extensions?.code === 'string' &&
    formattedError.extensions.code !== 'INTERNAL_SERVER_ERROR'
      ? formattedError.extensions.code
      : mapStatusCodeToGraphqlCode(responseCode);
  const requestId =
    typeof formattedError.extensions?.requestId === 'string'
      ? formattedError.extensions.requestId
      : undefined;

  if (code === 'GRAPHQL_PARSE_FAILED' || code === 'GRAPHQL_VALIDATION_FAILED') {
    return {
      message: formattedError.message,
      extensions: {
        code,
        ...(requestId ? { requestId } : {}),
      },
    };
  }

  if (
    code === 'GRAPHQL_DEPTH_LIMIT' ||
    code === 'GRAPHQL_COMPLEXITY_LIMIT' ||
    code === 'PERSISTED_QUERY_REQUIRED' ||
    code === 'PERSISTED_QUERY_NOT_ALLOWLISTED' ||
    code === 'PERSISTED_QUERY_NOT_FOUND' ||
    code === 'PERSISTED_QUERY_HASH_MISMATCH' ||
    code === 'UNAUTHENTICATED' ||
    code === 'FORBIDDEN' ||
    code === 'BAD_USER_INPUT' ||
    code === 'BAD_REQUEST' ||
    code === 'NOT_FOUND' ||
    code === 'TOO_MANY_REQUESTS'
  ) {
    return {
      message: responseMessage ?? formattedError.message,
      extensions: {
        code,
        ...(requestId ? { requestId } : {}),
      },
    };
  }

  return {
    message: 'Internal server error',
    extensions: {
      code: 'INTERNAL_SERVER_ERROR',
      ...(requestId ? { requestId } : {}),
    },
  };
}

function mapStatusCodeToGraphqlCode(statusCode?: number): string {
  switch (statusCode) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}
