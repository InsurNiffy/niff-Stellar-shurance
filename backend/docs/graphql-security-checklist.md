# GraphQL Security Review Checklist

Complete this checklist before broad exposure outside staging.

- GraphQL landing page is disabled in production.
- Production introspection policy is explicitly set and reviewed.
- Depth limit is configured and tested with a malicious nested query.
- Complexity limit is configured and tested with a wide query.
- Per-identity rate limiting is enabled on root GraphQL operations.
- Persisted queries are either disabled or backed by Redis with TTLs.
- Error formatting is masked and confirmed not to leak stack traces or resolver paths.
- Wallet-only operations reject staff tokens and anonymous callers.
- Staff-only operations, if added, verify role checks explicitly.
- Tenant scoping is verified on policy and claim reads.
- Slow-operation logs are visible in staging log aggregation.
- Slow Prisma query logs are visible in staging log aggregation.
- Query-plan-driven indexes are present in the target database.
- Representative nested load test passes with acceptable p95/p99 latency.
- Security sign-off captures the exact env values for depth, complexity, and rate-limit thresholds.
