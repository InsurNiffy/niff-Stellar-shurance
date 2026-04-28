# Contributing to niff-Stellar-shurance

Welcome. This guide takes you from a fresh clone to a passing CI run and an open PR. Follow it top-to-bottom on your first setup; after that, jump to whichever section you need.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Clone and bootstrap](#2-clone-and-bootstrap)
3. [Contract development (Rust / Soroban)](#3-contract-development-rust--soroban)
4. [Backend development (NestJS)](#4-backend-development-nestjs)
5. [Frontend development (Next.js)](#5-frontend-development-nextjs)
6. [CI quality gates](#6-ci-quality-gates)
7. [PR review process](#7-pr-review-process)
8. [Good first issues](#8-good-first-issues)
9. [Security rules](#9-security-rules)

---

## 1. Prerequisites

Install these before anything else.

| Tool | Version | Install |
|---|---|---|
| Node.js | `>=22` (see `.nvmrc`) | [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| npm | `>=10` | bundled with Node |
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Soroban CLI | latest | `cargo install --locked stellar-cli --features opt` |
| Docker | — | [Docker Desktop](https://www.docker.com/products/docker-desktop/) |
| PostgreSQL | 16 | via Docker (see below) or local install |
| Redis | 7 | via Docker (see below) or local install |

> **Node version:** run `nvm use` in the repo root to switch to the pinned version automatically.

---

## 2. Clone and bootstrap

```bash
git clone https://github.com/InsurNiffy/niff-Stellar-shurance.git
cd niff-Stellar-shurance
```

Start Postgres and Redis with Docker:

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
npm run export-spec            # regenerate backend/openapi.json
npm run error-catalog:check    # verify error codes are consistent
```

### Fixing CI: `unit-tests` job

| Failure | Fix |
|---|---|
| `npm test` fails | Run `npm test` locally and fix the failing test |
| `.env.example` drift | Run `npm run env:example:generate` and commit the updated file |
| `openapi.json` stale | Run `make generate-client` and commit the updated file |
| `npm audit` high/critical | Update or patch the flagged dependency |

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
# Commits: frontend/src/lib/api/generated/openapi.d.ts
```

### Fixing CI: `frontend` job

| Failure | Fix |
|---|---|
| `npm run lint` fails | Run `npm run lint -- --max-warnings=0` locally and fix all warnings |
| `npm run typecheck` fails | Run `npm run typecheck` locally and fix type errors |
| `npm run build` fails | Run `npm run build` locally — often a missing env var or type error |
| `npm test` fails | Run `npm test` locally and fix the failing test |
| Generated types stale | Run `make generate-client` and commit the updated `.d.ts` file |

### Fixing CI: `accessibility` job

| Failure | Fix |
|---|---|
| axe violations | Run `npx playwright test tests/accessibility.spec.ts` locally, open the HTML report, and fix the flagged violations before opening a PR |

### Fixing CI: `e2e-tests` job

The E2E job is `continue-on-error: true` — failures are reported but do not block merge. Check the uploaded Playwright report artifact for details.

---

## 6. CI quality gates

Every PR to `main` runs these jobs. All must pass (except `e2e-tests` which is advisory).

| Job | What it checks | Key commands to run locally |
|---|---|---|
| `frontend` | lint, typecheck, build, unit tests, generated types | `cd frontend && npm run lint -- --max-warnings=0 && npm run typecheck && npm run build && npm test` |
| `contract` | Rust tests, cargo audit, WASM build | `cargo test --workspace --features testutils && cargo audit && make build` |
| `unit-tests` | Backend unit tests, `.env.example` drift, OpenAPI spec drift | `cd backend && npm test && npm run env:example:check && npm run export-spec` |
| `golden-vectors` | Soroban ABI encoding (runs on contract/backend changes) | `cd backend && npm run refresh-vectors` |
| `migrations` | Prisma migration history and schema validity | `cd backend && npx prisma migrate deploy` |
| `accessibility` | axe/Playwright — no critical violations | `cd frontend && npx playwright test tests/accessibility.spec.ts` |
| `e2e-tests` | Playwright E2E (advisory, does not block merge) | `cd frontend && npm run test:e2e` |

### Before pushing

Run this checklist locally to avoid a CI round-trip:

```bash
# Contract
cargo fmt --all -- --check
cargo clippy --target wasm32-unknown-unknown --release -- -D warnings
cargo test --workspace --features testutils

# Backend
cd backend
npm run env:example:check
npm run export-spec
npm test

# Frontend
cd frontend
npm run lint -- --max-warnings=0
npm run typecheck
npm run build
npm test
```

---

## 7. PR review process

### Opening a PR

1. Branch off `main`: `git checkout -b feat/<short-description>` or `fix/<short-description>`.
2. Keep PRs focused — one logical change per PR.
3. Fill in the PR description: what changed, why, and how to test it.
4. Link the related issue if one exists.
5. All CI jobs must be green before requesting review (except the advisory `e2e-tests` job).

### Review requirements

- At least **one approving review** from a team member before merge.
- **Two approving reviews** required for any change to:
  - `backend/src/soroban/golden-vectors.json`
  - `contracts/` (any contract source or ABI)
  - `backend/prisma/schema.prisma` or migration files
  - `.github/workflows/`
- The author merges after approval — do not merge someone else's PR without their acknowledgement.

### Merge strategy

Squash-merge into `main`. Write a clear squash commit message following [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(claims): add idempotency key support to claim submission
fix(auth): prevent nonce reuse after wallet disconnect
chore(deps): bump stellar-sdk to 14.6.1
docs(contributing): add contract setup section
```

### After merge

- Delete the feature branch.
- If `openapi.json` or `golden-vectors.json` changed, notify the relevant team so downstream consumers can update.
- If a contract was deployed, update `contracts/deployment-registry.json` and open a follow-up PR.

---

## 8. Good first issues

Look for issues labelled **`good first issue`** on GitHub. These are scoped to be completable without deep knowledge of the full system.

### What makes a good first issue

- Self-contained change in one area (frontend, backend, or contract docs)
- Clear acceptance criteria
- No dependency on unreleased contract changes
- Estimated at under half a day

### Typical good first issue areas

| Area | Examples |
|---|---|
| Frontend | Fix a lint warning, add a missing `aria-label`, improve an error message |
| Backend | Add a missing field to an API response DTO, improve a log message, fix a typo in an error code |
| Docs | Clarify a setup step, add a missing env var description, fix a broken link |
| Contract | Add a `#[doc]` comment to a public function, fix a clippy warning |

### Getting started on an issue

1. Comment on the issue to claim it — avoids duplicate work.
2. Ask questions in the issue thread before writing code.
3. Open a draft PR early so reviewers can give early feedback.
4. Reference the issue in your PR description: `Closes #<issue-number>`.

---

## 9. Security rules

- **Never commit real private keys.** Stellar secret keys start with `S`. CI scans for this pattern and will fail.
- Use only placeholder G-addresses and C-addresses in test fixtures and golden vectors.
- Rotate all secrets (`JWT_SECRET`, `ADMIN_TOKEN`, `IP_HASH_SALT`, `CAPTCHA_SECRET_KEY`) before any production deploy — the backend will refuse to start with the example placeholder values.
- Store production secrets in a secrets manager (HashiCorp Vault, AWS SSM, Kubernetes Secrets) — never in `.env` files committed to the repo.
- `Cargo.lock` and `package-lock.json` are committed. Do not modify them without a deliberate dependency update PR.

---

## Accessibility

Every PR that touches UI must pass the checks in the `accessibility` CI job. See the [Accessibility Testing](#accessibility-testing) section below for the full checklist.

---

## Accessibility Testing

Accessibility is a first-class requirement. Every PR that touches UI must pass the checks below before merge.

### Automated axe checks (CI)

The `accessibility` CI job runs `@axe-core/playwright` against the quote, policy, claims, and vote routes. No critical violations are permitted. The job uploads a Playwright report as an artifact on failure.

Run locally:

```bash
cd frontend
npm run build
npx playwright test tests/accessibility.spec.ts
```

### Manual axe spot-check

1. Install the [axe DevTools browser extension](https://www.deque.com/axe/devtools/).
2. Open each targeted route: `/quote`, `/policy`, `/claims`, `/claims/<id>`.
3. Run the full-page scan. Resolve any critical or serious violations before opening a PR.

### Keyboard-only walkthrough

Verify these flows using only the keyboard (no mouse):

| Flow | Steps |
|---|---|
| Get a quote | Tab through all form fields → submit → confirm quote preview updates |
| Purchase policy | Complete all 4 wizard steps using Tab / Shift+Tab / Enter / Space |
| File a claim | Complete all 4 wizard steps; confirm focus moves to new step heading on advance |
| Cast a vote | Tab to Approve / Reject buttons → Enter to open confirm modal → Tab within modal → confirm or cancel |
| Connect wallet | Tab to "Connect Wallet" button → Enter → confirm status announced |

Focus must always be visible. After a modal opens, focus must move inside it. After a modal closes, focus must return to the trigger.

### Screen reader spot-check (per major release)

Test at minimum one major flow per release with a screen reader:

- **macOS / iOS**: VoiceOver (`Cmd+F5` to toggle)
- **Windows**: NVDA (free) or Narrator
- **Android**: TalkBack

Checklist:
- [ ] Transaction status updates are announced (aria-live regions on wizard and policy pages)
- [ ] Step changes in wizards are announced (focus moves to hidden `<h2>` with step name)
- [ ] Quote preview updates are announced on the quote page
- [ ] Vote tally countdown is announced via `aria-live="polite"`
- [ ] Modal title is read when dialog opens
- [ ] Icon-only buttons have accessible names (aria-label or sr-only text)
- [ ] Claim status badges convey outcome via text/shape, not color alone

### Reduced-motion

Verify that setting `prefers-reduced-motion: reduce` stops all non-essential animations. Loading spinners should become static; slide/fade transitions should be instant.

### Heading hierarchy

Each page must have exactly one `<h1>`. Use the browser Accessibility Tree panel or the [HeadingsMap extension](https://rumoroso.bitbucket.io/headingsmap/) to verify a logical heading order with no skipped levels.

### Landmarks

Every page must have at minimum: `<main>`, `<nav>` (if navigation present), and `<footer>` (if present).

### Color contrast

All text must meet WCAG AA contrast ratios (4.5:1 normal text, 3:1 large text). Claim outcomes (Approved / Rejected / Pending) must not rely on color alone — shape indicators and text labels are required.

### Adding new UI

When adding new interactive components:

1. Icon-only controls must have `aria-label` or a visually hidden label.
2. Async state changes (transactions, loading) must update an `aria-live` region.
3. Multi-step wizards must move focus to a step heading on step change.
4. Modals must trap focus and return it to the trigger on close (Radix Dialog handles this automatically).
5. Animations must respect `prefers-reduced-motion` via the global CSS rule in `globals.css`.

---

## Soroban ABI golden vectors (detail)

See [section 3](#3-contract-development-rust--soroban) for the refresh workflow. Additional rules:

- A second engineer must review and approve any vector changes before merge.
- Before tagging a release: run `npm run refresh-vectors` and confirm the diff is empty (or intentional), confirm `_meta.contractSemver` matches `Cargo.toml`, and update `contracts/deployment-registry.json` with the new wasm hash.
