# Contributing

## Git hooks (secret scanning)

This repository ships a Git pre-commit hook that runs [gitleaks](https://github.com/gitleaks/gitleaks) against staged changes to prevent committing secrets. The rules live in `.gitleaks.toml`.

Install the hooks once after cloning:

```sh
make install-hooks
```

This sets `core.hooksPath` to `.githooks` so the `pre-commit` hook runs automatically on every commit. Make sure `gitleaks` is installed and available on your `PATH` (e.g. `brew install gitleaks` or download a release binary).

If a commit is blocked because a secret was detected, remove the secret from the staged changes (or rotate it if it was already pushed) and commit again. Do not bypass the hook with `--no-verify`.

```bash
cd backend
docker compose up -d
```

Val
```

This sets `core.hooksPath` to `.githooks` so the `pre-commit` hook runs automatically on every commit. Make sure `gitleaks` is installed and available on your `PATH` (e.g. `brew install gitleaks` or download a release binary).

```bash
cd backend
docker compose up -d
```

Validate your local env files before starting anything:

```bash
make check-env
```

This checks `backend/.env` and `frontend/.env.local` for all required variables and prints a clear list of anything missing.

---

## 3. Contract development (Rust / Soroban)

The Soroban smart contract lives in `contracts/niffyinsure/`.

Domain terms that are easy to mix up — in particular **appeal** vs. **dispute**
vs. **escalation**, which have different triggering actors and different claim
status preconditions — are defined in [`docs/GLOSSARY.md`](docs/GLOSSARY.md).

### Setup

```bash
# Rust stable + wasm target (if not done in step 1)
rustup update stable
rustup target add wasm32-unknown-unknown

# Soroban CLI
cargo install --locked stellar-cli --features opt
```

### Run contract tests

```bash
cargo test --workspace --features testutils
```

### Build the WASM artifact

```bash
make wasm-release
# Output: artifacts/niffyinsure-<version>-<git-tag>.wasm
#         artifacts/niffyinsure-<version>-<git-tag>.wasm.sha256
```

### Lint and format

```bash
make fmt    # cargo fmt --check
make lint   # cargo clippy -D warnings
```

### Soroban ABI golden vectors

`backend/src/soroban/golden-vectors.json` records the exact ScVal encoding for every critical contract call. CI fails if the vectors drift.

Refresh after changing any contract function signature, argument builder, or enum variant:

```bash
cd backend
npm run refresh-vectors
git diff backend/src/soroban/golden-vectors.json   # review carefully
```

If the contract ABI changed, bump `_meta.contractSemver` in the JSON to match the new contract version. Commit the updated file — a second engineer must review any vector changes before merge.

### Fixing CI: `contract` job

| Failure | Fix |
|---|---|
| `cargo test` fails | Run `cargo test --workspace --features testutils` locally and fix the failing test |
| `cargo audit` fails | Run `cargo audit` and update or patch the flagged dependency |
| WASM build fails | Run `make build` and resolve the compiler error |

### Adding a new contract event variant

When you add a new `#[contractevent]` struct to `events.rs`:

1. Add the new event's `EventKey` to `backend/src/events/events.schema.ts` (`EventKey` union + `EVENT_PARSERS` entry + typed interface).
2. Add a decode test in `backend/src/events/events.test.ts` that constructs the raw payload and asserts `parseEvent` returns the correct typed result.
3. Update `docs/EVENT_DICTIONARY.md` with the new event's topic layout and payload schema.
4. If any field is **removed or its type changes**, bump `SCHEMA_VERSION` in `events.schema.ts` and add a new versioned parser entry — backward-compatible additions do not require a bump.

---

## 4. Backend development (NestJS)

The backend lives in `backend/`. It is a NestJS API backed by PostgreSQL (Prisma) and Redis.

### Setup

```bash
cd backend

# Copy and fill in env vars
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL, REDIS_URL, JWT_SECRET, ADMIN_TOKEN,
# FRONTEND_ORIGINS, CAPTCHA_SECRET_KEY, IP_HASH_SALT.
# See backend/docs/environment-variables.md for the full reference.

npm ci
npx prisma generate
npx prisma migrate dev   # applies all migrations to your local DB
```

### Start the dev server

```bash
npm run start:dev
# API available at http://localhost:3000
# Swagger UI at http://localhost:3000/api
```

### Run unit tests

```bash
npm test
```

### Run E2E tests (requires Docker)

The E2E suite spins up real Postgres and Redis containers via Testcontainers — no `.env` needed for this.

```bash
npm run test:e2e
```

> If a test hangs, check Docker is running: `docker info`.

### Useful backend scripts

```bash
npm run env:example:generate   # regenerate .env.example from env.definitions.ts
npm run env:example:check      # verify .env.example is not drifted
npm run openapi:generate       # regenerate backend/openapi.json from DTOs
npm run openapi:check          # regenerate and fail if openapi.json is stale
npm run error-catalog:check    # verify error codes are consistent
```

### OpenAPI spec drift

If you modify a backend DTO (request/response body), the OpenAPI spec must be regenerated:

```bash
cd backend
npm run openapi:generate
git add openapi.json
cd ..
make generate-client   # sync the TypeScript client with the new spec
```

The `Backend CI` workflow regenerates the spec on every PR and fails if it differs from the committed `backend/openapi.json`. Always regenerate and commit the updated spec (and the regenerated frontend client) when DTOs change.

### Fixing CI: `unit-tests` job

| Failure | Fix |
|---|---|
| `npm test` fails | Run `npm test` locally and fix the failing test |
| `.env.example` drift | Run `npm run env:example:generate` and commit the updated file |
| OpenAPI spec drift | Run `npm run openapi:generate`, commit the updated `backend/openapi.json`, then run `make generate-client` from the repo root |
| `npm audit` high/critical | Update or patch the flagged dependency |

### Fixing CI: `address-normalization` job

| Failure | Fix |
|---|---|
| Denormalized addresses detected | Run `cd backend && npx ts-node -r tsconfig-paths/register src/scripts/normalize-addresses.ts` to normalize all addresses in the database, then verify the fix with `--dry-run` |

### Fixing CI: `migrations` job

| Failure | Fix |
|---|---|
| Pending migrations detected | Run `npx prisma migrate dev` locally, commit the new migration file |
| Migration lock file invalid | Do not edit `migration_lock.toml` manually — it is managed by Prisma |

---

## 5. Frontend development (Next.js)

The frontend lives in `frontend/`. It is a Next.js 16 app using the App Router.

### Setup

```bash
cd frontend

# Copy and fill in env vars
cp .env.example .env.local
# At minimum set NEXT_PUBLIC_API_URL.
# See frontend/.env.example for all variables and their owners.

npm ci
```

### Start the dev server

```bash
npm run dev
# App available at http://localhost:3001
```

### Run unit tests

```bash
npm test
```

### Run Playwright E2E tests

```bash
npx playwright install --with-deps   # first time only
npm run test:e2e
```

### Run Storybook

```bash
npm run storybook
# Component explorer at http://localhost:6006
```

### Run accessibility checks

```bash
npm run build
npx playwright test tests/accessibility.spec.ts
```

### Regenerate OpenAPI types

Run this after the backend `openapi.json` changes:

```bash
make generate-client
# Commits: frontend/src/lib/api/generated/openapi.d
```

---

## 6. CI quality gates

Every PR must pass all required checks before merge. The full list lives in `.github/workflows/`. If a job fails, the tables in sections 3–5 tell you how to fix the common causes.

---

## 7. PR review process

- Keep PRs small and focused on a single issue.
- Reference the issue number in the PR title and body.
- A second engineer must review any change to contract ABI golden vectors, migrations, or security-sensitive code.
- Do not merge with failing required checks.

---

## 8. Good first issues

Issues labelled `good first issue` are scoped for new contributors. Comment on the issue to claim it before starting work.

---

## 9. Security rules

- Never commit secrets, tokens, or credentials. Use `.env` files (git-ignored) and the documented env reference.
- Report vulnerabilities privately per `SECURITY.md` — do not open a public issue.
- Run `gitleaks` locally before committing (see the launch readiness checklist below).
- If a commit is blocked because a secret was detected, remove the secret from the staged changes (or rotate it if it was already pushed) and commit again. Do not bypass the hook with `--no-verify`.

---

## 10. On-call operations

Operational runbooks live in `docs/ops/`. Start with the disaster recovery runbook at [`docs/ops/disaster-recovery-runbook.md`](docs/ops/disaster-recovery-runbook.md).

---

## 11. Dependency update policy

Dependency triage and update cadence are documented in [`docs/dependency-update-process.md`](docs/dependency-update-process.md). SDK upgrades follow [`docs/sdk-upgrade-checklist.md`](docs/sdk-upgrade-checklist.md).

---

## 12. Mainnet launch readiness checklist

Umbrella tracking checklist for all mainnet launch readiness items. **All items must be resolved before deploying with `STELLAR_NETWORK=mainnet`.**

- **Priority:** Critical
- **Layer:** All (Contract, Backend, Frontend, Ops)

Each item lists its status, an owner placeholder to be filled in when assigned, and the acceptance criteria that must be met to check it off. Update the status column in the PR that resolves the item.

### Contract

| Item | Status | Owner | Acceptance criteria |
|---|---|---|---|
| Multi-sig admin for treasury sweeps | ☐ Not started | _TBD_ | Treasury sweep operations require M-of-N admin signatures; single-key sweep path removed or gated; covered by contract tests. |
| Event replay protection (nonce enforcement) | ☐ Not started | _TBD_ | Every state-mutating entry point enforces a monotonic nonce; replayed events are rejected; tests cover replay attempts. |
| Oracle sign-then-verify pipeline | ☐ Not started | _TBD_ | Oracle payloads are signed off-chain and verified on-chain before use; invalid signatures rejected; tests cover tampered payloads. |
| Admin rotation co-signer enforcement | ☐ Not started | _TBD_ | Admin rotation requires the configured co-signer(s); unauthorized rotations rejected; tests cover the enforcement path. |

### Backend

| Item | Status | Owner | Acceptance criteria |
|---|---|---|---|
| Multi-tenant query isolation audit | ☐ Not started | _TBD_ | Audit confirms every tenant-scoped query filters by tenant; findings documented; any gaps fixed with tests. |
| Chain module network passphrase validation | ☐ Not started | _TBD_ | Chain module validates the configured network passphrase against `STELLAR_NETWORK`; mismatches fail fast at startup; tests cover mismatch. |
| Per-wallet rate limits for claim filing | ☐ Not started | _TBD_ | Claim filing is rate-limited per wallet; limits enforced and configurable; tests cover limit exceeded. |
| Webhook SSRF periodic re-validation | ☐ Not started | _TBD_ | Webhook URLs are re-validated on a schedule against SSRF rules; unsafe URLs disabled; tests cover re-validation. |
| GDPR right-to-erasure implementation | ☐ Not started | _TBD_ | Erasure requests remove or anonymize personal data per policy; audit trail retained; tests cover the erasure flow. |
| JWT secret rotation schedule | ☐ Not started | _TBD_ | Documented rotation schedule and procedure; rotation supported without invalidating active sessions beyond policy; runbook updated. |

### Frontend

| Item | Status | Owner | Acceptance criteria |
|---|---|---|---|
| Cookie consent gate for analytics | ☐ Not started | _TBD_ | Analytics scripts load only after consent; consent state persisted; tests cover gated loading. |
| Performance budget CI gate | ☐ Not started | _TBD_ | CI fails when performance budgets are exceeded; budgets documented; gate wired into required checks. |
| Claim filing accessibility audit | ☐ Not started | _TBD_ | Claim filing flow passes accessibility audit (keyboard, screen reader, contrast); findings fixed; audit documented. |
| CSP allowlist audit and tighten | ☐ Not started | _TBD_ | CSP allowlist reviewed and tightened to required origins only; violations monitored; change documented. |

### Ops

| Item | Status | Owner | Acceptance criteria |
|---|---|---|---|
| Contract E2E smoke tests on testnet | ☐ Not started | _TBD_ | Smoke tests exercise critical contract flows on testnet; run on schedule and before release; results documented. |
| gitleaks pre-commit hook installed | ☐ Not started | _TBD_ | `gitleaks` pre-commit hook installed and documented; contributors can enable it; verified to block secrets. |
| IPFS gateway allowlist enforcement | ☐ Not started | _TBD_ | Only allowlisted IPFS gateways are used; enforcement tested; configuration documented. |
| Cargo audit exceptions reviewed | ☐ Not started | _TBD_ | All `cargo audit` exceptions reviewed and justified; stale exceptions removed; review documented. |
| DR drill completed and documented | ☐ Not started | _TBD_ | Disaster recovery drill executed; results and gaps documented in `docs/ops/disaster-recovery-runbook.md`. |
| Contract upgrade rollback procedure documented | ☐ Not started | _TBD_ | Rollback procedure for contract upgrades documented and reviewed; steps verified in a drill. |
