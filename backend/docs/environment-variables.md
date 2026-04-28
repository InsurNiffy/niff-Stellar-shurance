# Environment Variables Reference

Source of truth: `backend/src/config/env.definitions.ts` (backend) and `frontend/src/config/env.ts` (frontend).

## Requirement labels

| Label | Meaning |
|---|---|
| `required` | Application boot fails immediately if missing or invalid |
| `optional` | Only needed when the related feature/integration is enabled |
| `conditional` | Required when another setting enables that integration |

---

## Backend (`backend/.env`)

Validation runs at startup via `validateEnvironment()` wired into NestJS `ConfigModule`.  
A missing or invalid required variable throws with a list of all failures before the process binds any port.

Generate or update `.env.example`:
```bash
cd backend && npm run env:example:generate
```

Verify `.env.example` is not drifted from `env.definitions.ts`:
```bash
cd backend && npm run env:example:check
```

### Core

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | required | Runtime environment: `development`, `production`, `test` |
| `PORT` | required | HTTP port bound by the Nest API process. Default: `3000` |
| `DATABASE_URL` | required | PostgreSQL connection string (`postgresql://...`) |
| `REDIS_URL` | required | Redis connection string (`redis://...` or `rediss://...`) |

### Stellar

| Variable | Required | Description |
|---|---|---|
| `STELLAR_NETWORK` | required | Active network: `testnet`, `mainnet`, `futurenet` |
| `SOROBAN_RPC_URL` | required | Soroban RPC endpoint for the active network |
| `HORIZON_URL` | required | Horizon endpoint for the active network |
| `STELLAR_NETWORK_PASSPHRASE` | required | Canonical network passphrase matching `STELLAR_NETWORK` |
| `CONTRACT_ID` | optional | Default niffyinsure contract ID for the active network |
| `DEFAULT_TOKEN_CONTRACT_ID` | optional | Default SEP-41 token contract ID |
| `SOROBAN_RPC_URL_TESTNET` | optional | Per-network RPC override for testnet |
| `SOROBAN_RPC_URL_MAINNET` | optional | Per-network RPC override for mainnet |
| `SOROBAN_RPC_URL_FUTURENET` | optional | Per-network RPC override for futurenet |
| `HORIZON_URL_TESTNET` | optional | Per-network Horizon override for testnet |
| `HORIZON_URL_MAINNET` | optional | Per-network Horizon override for mainnet |
| `HORIZON_URL_FUTURENET` | optional | Per-network Horizon override for futurenet |
| `CONTRACT_ID_TESTNET` | optional | Per-network contract override for testnet |
| `CONTRACT_ID_MAINNET` | conditional | Required when `STELLAR_NETWORK=mainnet` |
| `CONTRACT_ID_FUTURENET` | optional | Per-network contract override for futurenet |
| `DEFAULT_TOKEN_CONTRACT_ID_TESTNET` | optional | Per-network token contract override for testnet |
| `DEFAULT_TOKEN_CONTRACT_ID_MAINNET` | optional | Per-network token contract override for mainnet |
| `DEFAULT_TOKEN_CONTRACT_ID_FUTURENET` | optional | Per-network token contract override for futurenet |
| `INDEXER_GAP_ALERT_THRESHOLD_LEDGERS` | required | Alert when chain head minus last processed ledger exceeds this. Default: `100` |
| `INDEXER_GAP_ALERT_COOLDOWN_MS` | required | Minimum ms between repeated indexer gap alerts. Default: `3600000` |
| `HORIZON_API_KEY` | optional | API key for managed Horizon providers |

### IPFS

| Variable | Required | Description |
|---|---|---|
| `IPFS_PROVIDER` | required | `mock` or `pinata` |
| `PINATA_API_KEY` | conditional | Required when `IPFS_PROVIDER=pinata` |
| `PINATA_API_SECRET` | conditional | Required when `IPFS_PROVIDER=pinata` |
| `PINATA_GATEWAY_URL` | required | Gateway base URL for Pinata retrievals |
| `IPFS_MAX_FILE_SIZE` | required | Max upload size in bytes. Default: `52428800` (50 MB) |
| `IPFS_MIN_FILE_SIZE` | required | Min upload size in bytes. Default: `1` |
| `IPFS_STRIP_EXIF` | required | Strip EXIF metadata before pinning. Default: `true` |
| `IPFS_GATEWAY` | required | Public gateway base for viewing evidence. Default: `https://ipfs.io` |
| `ALLOWED_IPFS_GATEWAYS` | optional | Comma-separated allowed gateway hostnames |
| `IPFS_PROJECT_ID` | optional | Legacy IPFS project identifier |
| `IPFS_PROJECT_SECRET` | optional | Legacy IPFS project secret |

### Auth

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | required | HMAC signing secret (min 32 chars). Must be rotated in production |
| `JWT_EXPIRES_IN` | required | Access token lifetime, e.g. `7d` |
| `JWT_REFRESH_EXPIRES_IN` | required | Refresh token lifetime, e.g. `30d` |
| `JWT_ISSUER` | required | JWT issuer claim. Default: `niffyinsure` |
| `JWT_AUDIENCE` | required | JWT audience claim. Default: `niffyinsure-api` |
| `ADMIN_TOKEN` | required | Bootstrap/admin automation token (min 24 chars). Must be rotated in production |
| `AUTH_DOMAIN` | required | Domain embedded in wallet challenge messages |
| `NONCE_TTL_SECONDS` | required | Wallet login challenge lifetime in seconds. Default: `300` |
| `PAGINATION_HMAC_SECRET` | optional | HMAC secret for tamper-resistant pagination cursors |

### HTTP

| Variable | Required | Description |
|---|---|---|
| `FRONTEND_ORIGINS` | required | Comma-separated CORS-allowed frontend origins. Must use `https://` in production |
| `ADMIN_CORS_ORIGINS` | optional | Comma-separated CORS-allowed admin UI origins |

### Observability

| Variable | Required | Description |
|---|---|---|
| `LOG_LEVEL` | required | Minimum log level: `error`, `warn`, `log`, `verbose`, `debug`. Default: `info` |

### Caching

| Variable | Required | Description |
|---|---|---|
| `CACHE_TTL_SECONDS` | required | Default cache TTL in seconds. Default: `60` |
| `QUOTE_SIMULATION_CACHE_ENABLED` | required | Enable Redis caching for quote simulations. Default: `true` |
| `QUOTE_SIMULATION_CACHE_TTL_SECONDS` | required | Quote simulation cache TTL in seconds. Default: `30` |

### Support / CAPTCHA

| Variable | Required | Description |
|---|---|---|
| `CAPTCHA_PROVIDER` | required | `turnstile` or `hcaptcha`. Default: `turnstile` |
| `CAPTCHA_SECRET_KEY` | required | Server-side CAPTCHA verification secret. Must not be `dev-skip` in production |
| `CAPTCHA_SITE_KEY` | optional | Public CAPTCHA site key |
| `IP_HASH_SALT` | required | Salt for privacy-safe IP deduplication (min 16 chars). Must be rotated in production |

### Multi-tenancy

| Variable | Required | Description |
|---|---|---|
| `TENANT_RESOLUTION_ENABLED` | required | Enable tenant resolution from hostnames/headers. Default: `false` |
| `TENANT_BASE_DOMAIN` | required | Base domain for subdomain-based tenant resolution |

### Database

| Variable | Required | Description |
|---|---|---|
| `DB_POOL_MAX` | required | Maximum Prisma connection pool size. Default: `10` |
| `DB_POOL_MIN` | required | Minimum warm Prisma connections. Default: `2` |
| `DB_POOL_IDLE_TIMEOUT_MS` | required | Idle connection reclaim timeout in ms. Default: `30000` |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | required | Max wait for a free DB connection in ms. Default: `5000` |
| `DB_SLOW_QUERY_MS` | required | Warn when a query exceeds this latency. Default: `250` |

### GraphQL

| Variable | Required | Description |
|---|---|---|
| `GRAPHQL_ENABLED` | required | Enable the GraphQL endpoint. Default: `true` |
| `GRAPHQL_PATH` | required | HTTP path for GraphQL. Default: `/graphql` |
| `GRAPHQL_INTROSPECTION_IN_PRODUCTION` | required | Allow introspection in production. Default: `false` |
| `GRAPHQL_MAX_DEPTH` | required | Maximum selection depth. Default: `8` |
| `GRAPHQL_MAX_COMPLEXITY` | required | Maximum query complexity. Default: `250` |
| `GRAPHQL_RATE_LIMIT_MAX` | required | Max operations per rate-limit window. Default: `60` |
| `GRAPHQL_RATE_LIMIT_WINDOW_MS` | required | Rate-limit window in ms. Default: `60000` |
| `GRAPHQL_SLOW_OPERATION_MS` | required | Warn when an operation exceeds this latency. Default: `750` |
| `GRAPHQL_PERSISTED_QUERIES_ENABLED` | required | Enable persisted queries. Default: `false` |
| `GRAPHQL_PERSISTED_QUERY_TTL_SECONDS` | required | Persisted query cache TTL. Default: `86400` |
| `GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT` | required | Default nested claims page size. Default: `10` |
| `GRAPHQL_POLICY_CLAIMS_MAX_LIMIT` | required | Maximum nested claims page size. Default: `25` |

### Notifications

| Variable | Required | Description |
|---|---|---|
| `SMTP_HOST` | required | SMTP host. Default: `127.0.0.1` |
| `SMTP_PORT` | required | SMTP port. Default: `1025` |
| `SMTP_USER` | optional | SMTP username for authenticated delivery |
| `SMTP_PASS` | optional | SMTP password for authenticated delivery |
| `SMTP_FROM` | required | From address for notification emails |
| `TELEGRAM_BOT_TOKEN` | optional | Telegram Bot API token |
| `DISCORD_WEBHOOK_URL` | optional | Discord webhook URL |

### Feature flags

| Variable | Required | Description |
|---|---|---|
| `FEATURE_FLAGS_JSON` | optional | JSON object of backend feature flags, e.g. `{"ramp":false}` |
| `FEATURE_FLAGS_DISABLED_STATUS` | required | HTTP status when a flag is disabled: `403` or `404`. Default: `404` |

### Ramp

| Variable | Required | Description |
|---|---|---|
| `RAMP_URL` | optional | Base URL for the fiat on-ramp integration |
| `RAMP_ALLOWED_REGIONS` | optional | Comma-separated ISO region codes where on-ramp is allowed |
| `RAMP_UTM_SOURCE` | required | UTM source appended to ramp URLs. Default: `niffyinsure` |
| `RAMP_UTM_MEDIUM` | required | UTM medium appended to ramp URLs. Default: `app` |
| `RAMP_UTM_CAMPAIGN` | required | UTM campaign appended to ramp URLs. Default: `onramp` |

### Operations

| Variable | Required | Description |
|---|---|---|
| `SSE_MAX_CONNECTIONS` | required | Maximum concurrent SSE connections. Default: `500` |
| `DATA_RETENTION_DAYS` | required | Days to retain soft-deleted rows before purge. Default: `730` |
| `SOLVENCY_MONITORING_ENABLED` | required | Enable scheduled solvency monitoring. Default: `true` |
| `SOLVENCY_CRON_EXPRESSION` | required | Cron expression for solvency runs. Default: `0 */15 * * * *` |
| `SOLVENCY_BUFFER_THRESHOLD_STROOPS` | required | Minimum treasury buffer before warnings fire. Default: `0` |
| `SOLVENCY_SIMULATION_SOURCE_ACCOUNT` | optional | Stellar account for solvency simulation calls |
| `SOLVENCY_TENANT_ID` | optional | Tenant identifier to scope solvency monitoring |
| `SOLVENCY_ALERT_WEBHOOK_URL` | optional | Webhook URL for solvency alert notifications |
| `SOLVENCY_ALERT_WEBHOOK_SECRET` | optional | Shared secret for solvency alert webhooks |
| `WASM_DRIFT_WEBHOOK_URL` | optional | Webhook URL for wasm drift alerts |
| `WASM_DRIFT_WEBHOOK_SECRET` | optional | Shared secret for wasm drift alerts |
| `DEPLOYMENT_REGISTRY_PATH` | required | Path to the contract deployment registry JSON. Default: `contracts/deployment-registry.json` |
| `NIFFYINSURE_EXPECTED_WASM_HASH` | optional | Expected SHA-256 hash of the authorised wasm artifact |
| `DISABLE_REINDEX_WORKER` | required | Disable the legacy reindex worker: `0` or `1`. Default: `0` |
| `RENEWAL_REMINDER_CRON` | required | Cron expression for renewal reminder jobs. Default: `0 * * * *` |

### Webhooks

| Variable | Required | Description |
|---|---|---|
| `WEBHOOK_SECRET_GITHUB` | optional | GitHub webhook secret for signature verification |
| `WEBHOOK_SECRET_STRIPE` | optional | Stripe webhook secret for signature verification |
| `WEBHOOK_SECRET_GENERIC` | optional | Generic webhook secret for signature verification |
| `WEBHOOK_IP_ALLOWLIST_GITHUB` | optional | Comma-separated IP allowlist for GitHub webhooks |
| `WEBHOOK_IP_ALLOWLIST_STRIPE` | optional | Comma-separated IP allowlist for Stripe webhooks |
| `WEBHOOK_IP_ALLOWLIST_GENERIC` | optional | Comma-separated IP allowlist for generic webhooks |

---

## Frontend (`frontend/.env.local`)

Validation runs at module load time via `zod` in `frontend/src/config/env.ts`.  
A missing or invalid required variable throws before any page renders.  
Additionally, `next.config.mjs` validates required vars at `next build` time so CI catches misconfigurations before deployment.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | required | Backend REST API base URL — no trailing slash |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | optional | Soroban RPC endpoint. Default: `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_HORIZON_URL` | optional | Horizon REST endpoint. Default: `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_CONTRACT_ID` | optional | Deployed niffyinsure contract ID for the active network |
| `NEXT_PUBLIC_IPFS_GATEWAY` | optional | IPFS gateway base URL. Default: `https://ipfs.io/ipfs` |
| `NEXT_PUBLIC_NETWORK` | optional | Active Stellar network: `testnet` or `public`. Default: `testnet` |
| `NEXT_PUBLIC_CAPTCHA_SITE_KEY` | optional | Public CAPTCHA site key |
| `NEXT_PUBLIC_CAPTCHA_PROVIDER` | optional | CAPTCHA provider: `turnstile` or `hcaptcha`. Default: `turnstile` |
| `NEXT_PUBLIC_RAMP_ENABLED` | optional | Enable the on-ramp button. Default: `false` |
| `NEXT_PUBLIC_RAMP_ANALYTICS` | optional | Emit anonymized ramp click analytics. Default: `false` |

---

## Local dev setup check

Validate both `.env` files before starting the dev server:

```bash
npx ts-node scripts/check-env-local.ts
# or
make check-env
```

This script checks that all required variables are present and non-empty in `backend/.env` and `frontend/.env.local`.
