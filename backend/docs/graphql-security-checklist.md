# GraphQL Security Review Checklist

Complete this checklist before broad exposure outside staging.

- [x] GraphQL landing page is disabled in production.
- [x] Production introspection policy is explicitly set and reviewed.
- [x] Depth limit is configured and tested with a malicious nested query.
- [x] Complexity limit is configured through `GRAPHQL_MAX_COMPLEXITY` and enforced before resolver execution.
- [x] Per-identity rate limiting is enabled on root GraphQL operations.
- [x] Persisted queries are required by default in production and backed by Redis with TTLs.
- [x] Production ad-hoc query registration is disabled unless `GRAPHQL_PERSISTED_QUERY_REGISTRATION_ENABLED=true`.
- [x] Optional production allowlist is supported through `GRAPHQL_PERSISTED_QUERY_ALLOWLIST`.
- [x] Error formatting is masked and confirmed not to leak stack traces or resolver paths.
- [x] Wallet-only operations reject staff tokens and anonymous callers.
- [ ] Staff-only operations, if added, verify role checks explicitly.
- [ ] Tenant scoping is verified on policy and claim reads.
- [ ] Slow-operation logs are visible in staging log aggregation.
- [ ] Slow Prisma query logs are visible in staging log aggregation.
- [ ] Query-plan-driven indexes are present in the target database.
- [ ] Representative nested load test passes with acceptable p95/p99 latency.
- [ ] Security sign-off captures the exact env values for depth, complexity, and rate-limit thresholds.

## Production persisted query policy

Set these values explicitly before enabling the public GraphQL endpoint:

| Env var | Production default | Purpose |
|---|---:|---|
| `GRAPHQL_PERSISTED_QUERIES_ENABLED` | `false` | Enables Redis-backed persisted query lookup. Set to `true` in production. |
| `GRAPHQL_PERSISTED_QUERIES_REQUIRED` | `true` | Rejects requests without `extensions.persistedQuery.sha256Hash`. |
| `GRAPHQL_PERSISTED_QUERY_REGISTRATION_ENABLED` | `false` | Prevents arbitrary clients from registering new query text in production. |
| `GRAPHQL_PERSISTED_QUERY_ALLOWLIST` | empty | Comma-separated SHA-256 hashes allowed to seed Redis when registration is disabled. |
| `GRAPHQL_PERSISTED_QUERY_TTL_SECONDS` | `86400` | Redis TTL for persisted query text. |
