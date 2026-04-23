# Tenant Isolation — Architecture & Guarantees

## Overview

NiffyInsure supports multi-tenant (white-label) deployments via **logical row-level
isolation**. All tenants share the same PostgreSQL database and Soroban contract.
Physical isolation (separate DB or contract per tenant) requires a separate deployment.

## Isolation level

| Layer | Isolation type | Notes |
|---|---|---|
| Database | Logical (row-level filter) | `tenantId` column on `claims` and `policies` |
| Cache (Redis) | Logical (key namespace) | Cache keys prefixed with `tenantId` |
| Soroban contract | None (shared) | Contract is tenant-unaware; isolation is off-chain only |
| Auth (JWT) | None (shared) | JWTs are not tenant-scoped in the current implementation |

**Operators must understand**: this is logical separation only. A bug in the
application layer could theoretically expose cross-tenant data. For strict
physical isolation, deploy separate instances per tenant.

## How it works

### 1. Tenant resolution (per request)

`TenantMiddleware` runs on every request and populates the REQUEST-scoped
`TenantContextService` with the resolved `tenantId`:

1. `x-tenant-id` header (explicit — used by API integrations)
2. Subdomain: `<tenantId>.niffyinsur.com` → extracted from `Host` header

Tenant IDs must match `/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$|^[a-z0-9]{3}$/`.
Invalid values are silently ignored (tenantId stays null).

### 2. Query scoping

Every repository query on a tenant-scoped model calls `claimTenantWhere()` or
`policyTenantWhere()` which merges `{ tenantId }` into the Prisma `where` clause.

```typescript
// Example — claims list
const where = claimTenantWhere(tenantId, { status: 'PENDING' });
// → { tenantId: 'acme', status: 'PENDING' }  (multi-tenant)
// → { status: 'PENDING' }                    (single-tenant, tenantId=null)
```

### 3. Ownership assertion after findUnique

After fetching a record by primary key, `assertTenantOwnership()` verifies the
record's `tenantId` matches the request tenant. Returns 404 (not 403) to avoid
leaking resource existence to other tenants.

```typescript
const claim = await prisma.claim.findUnique({ where: { id } });
assertTenantOwnership(claim, tenantId, `Claim ${id}`);
```

### 4. Cache namespacing

Cache keys include the tenantId to prevent cross-tenant cache poisoning:

```
claims:list:acme:start:20:all
claims:detail:acme:42
```

## Single-tenant mode (default)

When `TENANT_RESOLUTION_ENABLED=false` (the default):

- `TenantMiddleware` is a no-op
- `tenantId` is always `null`
- `tenantFilter(null)` returns `{}`
- All queries behave identically to pre-tenant code paths
- No performance overhead

## Enabling multi-tenant mode

```env
TENANT_RESOLUTION_ENABLED=true
TENANT_BASE_DOMAIN=niffyinsur.com
```

Run the Prisma migration to add `tenantId` columns and indexes:

```bash
npx prisma migrate dev --name add-tenant-id
```

## Database indexes

The following composite indexes are added to support tenant-scoped queries
without full table scans:

```
claims:    (tenantId), (tenantId, status), (tenantId, createdAt, id)
policies:  (tenantId), (tenantId, isActive), (tenantId, createdAt, id)
```

The `(tenantId, createdAt, id)` index matches the keyset pagination query shape:
`WHERE tenantId = ? AND (createdAt, id) < (?, ?) ORDER BY createdAt DESC, id DESC`.

## Legal considerations

If handling user data on behalf of a tenant (white-label partner), a Data
Processing Agreement (DPA) is required under GDPR and similar regulations.
Consult qualified legal counsel before onboarding tenants who process EU/UK
personal data. Each tenant's users should be informed of the sub-processor
relationship in the tenant's own privacy policy.

## Tenant Context Propagation Path

The full request-to-query propagation path is:

```
HTTP Request
    ↓
TenantMiddleware  ── resolves tenantId from header / subdomain
    ↓
TenantContextService (REQUEST-scoped)  ── stores tenantId for the request
    ↓
Service Layer (e.g. ClaimsService)  ── reads tenantId from TenantContextService
    ↓
tenant-filter helper (claimTenantWhere / policyTenantWhere / voteTenantWhere)
    ↓
Prisma Query  ── WHERE clause includes tenantId filter
```

### Key enforcement points

1. **Middleware**: `TenantMiddleware` runs on every request and populates `TenantContextService`.
2. **Query helpers**: Every repository query MUST call `claimTenantWhere()`, `policyTenantWhere()`, or `voteTenantWhere()` to merge the tenant filter.
3. **Ownership assertion**: After `findUnique` / `findFirst`, `assertTenantOwnership()` verifies the record belongs to the request tenant (returns 404 to avoid leaking existence).

## CI Check

A automated CI check (`npm run ci:tenant-check`) scans all TypeScript source files
and fails if any Prisma query on `claim` or `policy` does not use the tenant-filter
helpers. This prevents new queries from accidentally bypassing tenant isolation.

```yaml
# Example GitHub Actions step
- name: Tenant isolation check
  run: npm run ci:tenant-check
```

## Single-tenant deployments

When `TENANT_RESOLUTION_ENABLED=false` (default):

- `TenantMiddleware` is a no-op
- `tenantId` is always `null`
- `tenantFilter(null)` returns `{}` — no filter added
- All queries behave identically to pre-tenant code paths
- No performance overhead

## Limitations

- Soroban contract events are not tenant-scoped. The indexer assigns `tenantId`
  based on configuration, not on-chain data.
- Votes are not tenant-scoped (the `votes` table has no `tenantId`). Votes are
  linked to claims which are tenant-scoped, so cross-tenant vote reads are
  prevented transitively.
- Admin endpoints currently bypass tenant scoping. Admin operators can see all
  tenants' data. Restrict admin access accordingly.
