# GraphQL API (read-only)

Issue #1482 adds a **read-only** GraphQL endpoint alongside the existing REST API.
It exposes `Policy`, `Claim`, `Vote` and `Holder` types via Apollo, with DataLoader
batching and strict query limits.

## Endpoint

- `POST /graphql` — Apollo Server (code-first schema).
- `GET /graphql` — Apollo Sandbox in non-production only.

## Schema

Code-first schema with resolvers backed by the **same services as REST**
(`policyService`, `claimService`, `voteService`, `holderService`). No resolver
talks to the database directly, so REST and GraphQL stay consistent.

```graphql
"""A policy record."""
type Policy {
  id: ID!
  title: String!
  status: String!
  holder: Holder
  claims: [Claim!]!
  votes: [Vote!]!
}

"""A claim filed against a policy."""
type Claim {
  id: ID!
  policyId: ID!
  status: String!
  policy: Policy
}

"""A vote cast on a policy."""
type Vote {
  id: ID!
  policyId: ID!
  voter: Holder
  policy: Policy
}

"""A policy holder."""
type Holder {
  id: ID!
  address: String!
  policies: [Policy!]!
}

type Query {
  policy(id: ID!): Policy
  policies(limit: Int, offset: Int): [Policy!]!
  claim(id: ID!): Claim
  claims(policyId: ID!): [Claim!]!
  vote(id: ID!): Vote
  votes(policyId: ID!): [Vote!]!
  holder(id: ID!): Holder
  holderByAddress(address: String!): Holder
}
```

## DataLoader (N+1 prevention)

A **fresh DataLoader per request** is created in the Apollo context and used by
relation resolvers (`Policy.holder`, `Policy.claims`, `Policy.votes`,
`Claim.policy`, `Vote.policy`, `Vote.voter`, `Holder.policies`). Batching collapses
N+1 lookups into a single service call per relation per request. Tests assert the
query count stays constant as the number of parent rows grows.

## Query limits

- **Depth limit** — queries deeper than the configured maximum are rejected.
- **Complexity limit** — estimated cost above the configured maximum is rejected.
- **Per-operation rate limit** — each operation is rate limited per client.
- **Introspection** — disabled in production; enabled in development.

Rejections return a GraphQL error and never reach the resolvers.

## Auth

GraphQL reuses the **REST auth guards**:

- **Wallet auth** is required for a caller's own data (own policies, claims, votes).
- **Admin** is required for admin-only fields.

Unauthenticated or unauthorized access to protected fields returns an auth error.

## Why writes stay on REST

This issue is intentionally **read-only** — there are **no mutations**. Writes
remain on REST because:

- REST write endpoints already own validation, idempotency and audit logging.
- Keeping a single write path avoids two divergent sources of truth for state
  transitions (policy, claim and vote lifecycle rules).
- GraphQL writes would need the same transactional guarantees and would duplicate
  the REST guards without adding value for current clients.

Read-only GraphQL gives dashboards and partners the flexible querying they want
while REST stays the authoritative write surface.
