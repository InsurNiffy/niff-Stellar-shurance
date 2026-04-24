# GraphQL API

The backend exposes GraphQL through NestJS Apollo using a code-first schema in [`src/graphql`](../src/graphql).
Resolvers stay intentionally thin:

- `PolicyResolver` delegates reads to [`PolicyReadService`](../src/policy/policy-read.service.ts)
- `ClaimResolver` delegates reads to [`ClaimsService`](../src/claims/claims.service.ts)
- claim view shaping is shared through [`ClaimViewMapper`](../src/claims/claim-view.mapper.ts)

No resolver contains standalone business rules that diverge from the REST layer.

## Endpoint

- Path: `/api/graphql`
- Driver: Apollo Server via `@nestjs/apollo`
- Schema generation: code-first, emitted to `src/graphql/schema.gql`

## Production policy

- Apollo landing page/playground is enabled only outside production.
- Introspection is disabled in production unless `GRAPHQL_INTROSPECTION_IN_PRODUCTION=true`.
- Error responses are masked. Clients receive only `{ message, extensions.code, extensions.requestId }`.
- GraphQL error payloads do not include stack traces or resolver paths.

## Abuse controls

- Depth guard: `GRAPHQL_MAX_DEPTH` (default `8`)
- Complexity guard: `GRAPHQL_MAX_COMPLEXITY` (default `250`)
- Per-identity operation rate limit:
  - `GRAPHQL_RATE_LIMIT_MAX` (default `60`)
  - `GRAPHQL_RATE_LIMIT_WINDOW_MS` (default `60000`)
- Persisted queries:
  - opt-in with `GRAPHQL_PERSISTED_QUERIES_ENABLED=true`
  - stored in Redis under `graphql:apq:*`
  - TTL controlled by `GRAPHQL_PERSISTED_QUERY_TTL_SECONDS`

## DataLoader strategy

Per-request DataLoaders are created inside the resolvers for the two high-fanout edges:

- `Policy.claims(first: Int)` batches `policy -> claims`
- `Claim.policy` batches `claim -> policy`

This is the main N+1 protection for representative nested graphs such as:

```graphql
query PoliciesWithClaims {
  policies(first: 20) {
    items {
      id
      claims(first: 10) {
        id
        status
      }
    }
  }
}
```

## Caching semantics

- GraphQL does not add a full-response cache today.
- `ClaimsService` still reuses the existing Redis caches used by REST claim list/detail flows.
- Persisted queries cache only the query document, not the response payload.
- Clients should treat GraphQL reads as live data with the same eventual-consistency profile as the indexed REST endpoints.

## Monitoring

- Slow GraphQL operations emit `graphql_slow_operation` structured logs.
- Slow Prisma queries emit `prisma_slow_query` structured logs.
- Prometheus metrics:
  - `graphql_operation_duration_seconds`
  - `graphql_operations_total`
- Supporting indexes were added for the real GraphQL access paths:
  - `claims(policyId, deleted_at, createdAt)`
  - `votes(claimId, deleted_at)`

## Load testing

Use [`loadtests/graphql-policy-claim-nested.js`](../loadtests/graphql-policy-claim-nested.js) against staging to validate:

- nested query latency under representative concurrency
- deterministic rejection of deep malicious queries
- no regression after schema or index changes
