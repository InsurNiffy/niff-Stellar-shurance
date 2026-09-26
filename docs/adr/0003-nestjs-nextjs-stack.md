# ADR-0003: NestJS (backend) + Next.js (frontend) stack selection

**Status:** Accepted

**Date:** 2024-02-20

**Deciders:** core team

---

## Context

We needed to choose a web application stack for the off-chain layer of the protocol: an API server that indexes Stellar/Soroban events, manages user accounts, and drives the claims workflow; and a frontend that exposes the full product UI.

Requirements:
- TypeScript throughout — shared types between API and UI reduce integration bugs.
- Strong OpenAPI support for the REST layer (used by external integrators and the mobile client).
- SSR/SSG capability for landing pages and SEO-sensitive routes.
- PostgreSQL + Prisma for relational data (policies, claims, audit logs).
- Active ecosystem with accessible hiring pool.

## Decision

We use **NestJS** for the backend API and **Next.js (App Router)** for the frontend.

NestJS provides opinionated module structure, first-class decorator-based OpenAPI generation (via `@nestjs/swagger`), dependency injection, and Guards/Interceptors that map cleanly to our auth and rate-limiting requirements. Next.js App Router gives us React Server Components for fast initial load on landing and policy pages, combined with Client Components for real-time voting UI, without operating a separate SSR service.

Both are TypeScript-first, share generated OpenAPI types via `make generate-client`, and have large communities that ease hiring and open-source library availability.

## Consequences

### Positive
- End-to-end TypeScript eliminates an entire class of type-boundary bugs between API and UI.
- `@nestjs/swagger` generates `backend/openapi.json` automatically; CI fails if the spec drifts.
- Next.js App Router Server Components reduce JS bundle size on info-heavy pages (quote, policy detail).
- NestJS Guards integrate directly with our JWT + wallet-signature auth model.
- Both frameworks have strong observability story (OpenTelemetry, Prometheus metrics) aligned with `backend/docs/opentelemetry-tracing.md`.

### Negative
- NestJS decorator-heavy style requires TypeScript `experimentalDecorators`; metadata reflection can produce subtle bugs if decorators are mis-ordered.
- Next.js App Router is still evolving; several ecosystem libraries (testing, i18n) had rough edges at adoption time.
- Two separate Node.js processes (backend port 3000, frontend port 3001) add local dev complexity; Docker Compose handles this in CI.

### Neutral / mitigations
- `make generate-client` regenerates `frontend/src/lib/api/generated/openapi.d.ts` from `backend/openapi.json`; a CI step fails if the generated file is stale.
- `backend/.nvmrc` and `frontend/.nvmrc` both pin the same Node.js LTS version to avoid split-brain version issues (see Node version matrix CI, ADR companion issue #951).
- Internationalization is handled by `next-intl` with locale files under `frontend/src/i18n/`; see `frontend/LOCALES.md`.

## Alternatives considered

| Option | Why rejected |
|--------|-------------|
| Express (backend) | No built-in DI, no decorator-based OpenAPI; requires assembling many libraries to reach parity with NestJS |
| Fastify (backend) | Better raw throughput, but plugin ecosystem is smaller; OpenAPI integration requires more manual wiring |
| tRPC (full-stack) | Type-safety is excellent but limited to TypeScript clients; external REST integrators (mobile, partner APIs) would need a separate REST layer anyway |
| Remix (frontend) | Strong SSR story but smaller component ecosystem; team had more Next.js experience |
| SvelteKit (frontend) | Smaller bundle, simpler mental model, but reduced TypeScript ecosystem maturity and fewer Stellar-wallet adapter examples at evaluation time |
