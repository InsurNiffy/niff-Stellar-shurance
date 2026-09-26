# NiffyInsure Backend

NestJS API for Stellar-based insurance platform.

## Validation

Global `ValidationPipe` enabled with `whitelist: true, forbidNonWhitelisted: true`.

- **Unknown fields:** Rejected (400 VALIDATION_ERROR).
- **Invalid values:** Field-specific errors.

### Error Shape (400 VALIDATION_ERROR)
RFC7807-inspired for frontend i18n:

```json
{
  "statusCode": 400,
  "error": {
    "type": "https://datatracker.ietf.org/doc/html/rfc7807#section-3.1",
    "code": "VALIDATION_ERROR",
    "title": "One or more validation errors occurred.",
    "violations": [
      {
        "field": "user.email",
        "code": "isEmail",
        "reason": "email must be an email"
      }
    ]
  },
  "timestamp": "2024-...",
  "path": "/api/..."
}
```

**Common codes (i18n keys):**
| Code | Meaning |
|------|---------|
| isDefined | Field required |
| min | Too small |
| max | Too large |
| isEmail | Invalid email |
| isUUID | Invalid UUID |
| matches | Regex fail (e.g. Stellar pubkey `/^G[A-Z2-7]{55}$/`) |
| isEnum | Invalid enum value |
| isInt/isNumber | Not number |
| length/minLength/maxLength | String length |
| isPositive | ≤0 |

### Auth Errors (401/403)
Generic `{statusCode, message}` (no violations – security: no hints).

### Security
- **Mass-assignment:** Whitelist blocks unexpected fields.
- **Type coercion:** `transform: true` safe (string→bool/num post-validation, no injection).
- **Review:** All DTOs decorated; nested `@ValidateNested/@Type`.

## API
See `/docs`.

### Response Envelope

All successful and error responses follow a standard envelope format: `{ data, meta, errors }`.

**Successful response:**
```json
{
  "data": { /* response payload */ },
  "meta": { /* pagination or metadata */ },
  "errors": null
}
```

**Paginated response:**
```json
{
  "data": [
    { /* items */ }
  ],
  "meta": {
    "total": 42,
    "cursor": "next_cursor_value"
  },
  "errors": null
}
```

**Error response:**
```json
{
  "data": null,
  "meta": {
    "statusCode": 400,
    "timestamp": "2024-...",
    "path": "/api/v1/...",
    "requestId": "uuid"
  },
  "errors": [
    {
      "code": "VALIDATION_ERROR",
      "message": "One or more validation errors occurred.",
      "i18nKey": "error.validation"
    }
  ]
}
```

### Versioning

REST routes are versioned with a URI prefix: **`/api/v1/...`** (NestJS URI versioning, default version `1`).

- **Current version:** `v1` — all controllers are served under `/api/v1/` unless noted otherwise.
- **Deprecated routes:** Handlers marked with `@DeprecatedApi()` respond with `Deprecation: true` and an HTTP-date `Sunset` header (`DEPRECATED_API_SUNSET_HTTP_DATE` in `src/common/versioning/api-versioning.constants.ts`). Experimental endpoints under `/api/v1/experimental/*` are deprecated and scheduled for removal after the sunset date.
- **Production:** Requests to `/api/*` without a `v{n}` segment (except `/docs` and `/openapi.json`) return **404** via `RejectUnversionedApiMiddleware`.

## GraphQL

GraphQL is exposed at `/api/v1/graphql` (same global API version prefix).

- Schema style: code-first (`src/graphql`)
- Production introspection defaults to off
- Apollo landing page is disabled in production
- Depth and complexity limits: `MAX_QUERY_DEPTH` / `MAX_QUERY_COMPLEXITY` (fallback: `GRAPHQL_MAX_DEPTH` / `GRAPHQL_MAX_COMPLEXITY`). Breaches return HTTP 400 with `GRAPHQL_DEPTH_LIMIT` or `GRAPHQL_COMPLEXITY_LIMIT`.
- See [`docs/graphql.md`](./docs/graphql.md)
- Security sign-off checklist: [`docs/graphql-security-checklist.md`](./docs/graphql-security-checklist.md)

## Local Dev
```bash
cd backend
npm i
npm run env:example:generate
npm run start:dev
```

Environment configuration is defined in [`src/config/env.definitions.ts`](/home/json/Desktop/Drips/niff-Stellar-shurance/backend/src/config/env.definitions.ts). Update that file first, then regenerate [`backend/.env.example`](/home/json/Desktop/Drips/niff-Stellar-shurance/backend/.env.example) with `npm run env:example:generate`.

Secrets guidance and rotation procedures live in [`docs/ops/secrets-management-runbook.md`](/home/json/Desktop/Drips/niff-Stellar-shurance/docs/ops/secrets-management-runbook.md). Generate a fresh JWT signing key with `npm run secrets:generate:jwt`.

## Deployment
Docker: `make docker-up`

See Makefile.
