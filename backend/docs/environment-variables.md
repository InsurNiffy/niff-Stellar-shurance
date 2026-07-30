# Environment Variables Reference

> **Auto-generated** from `backend/src/config/env.definitions.ts`.
> Do not edit manually — run `npm run env:example:generate` in `backend/` to regenerate.

## Requirement labels

| Label | Meaning |
|---|---|
| `required` | Application boot fails immediately if missing or invalid |
| `optional` | Only needed when the related feature/integration is enabled |
| `conditional` | Required when another setting enables that integration |

---

## Core

| Variable | Required | Description | Default |
|---|---|---|---|
| `NODE_ENV` | `required` | Runtime environment name used for validation and defaults. | `development` |
| `PORT` | `required` | HTTP port bound by the Nest API process. | `3000` |
| `DATABASE_URL` | `required` | Primary PostgreSQL connection string. Use a least-privilege application user for writes. *(secret)* | `postgresql://niffy_app:replace-me@localhost:5432/niffyinsure?schema=public` |
| `REDIS_URL` | `required` | Redis connection string for cache, queues, and nonce storage. *(secret)* | `redis://localhost:6379/0` |

## Stellar

| Variable | Required | Description | Default |
|---|---|---|---|
| `STELLAR_NETWORK` | `required` | Active Stellar network for RPC, Horizon, and contract resolution. | `testnet` |
| `SOROBAN_RPC_URL` | `required` | Soroban RPC endpoint for the active network. | `https://soroban-testnet.stellar.org` |
| `SOROBAN_SIMULATE_TIMEOUT_MS` | `required` | Max ms to wait for simulate_transaction before returning 504 (issue #895). | `30000` |
| `HORIZON_URL` | `required` | Horizon endpoint for the active network. | `https://horizon-testnet.stellar.org` |
| `STELLAR_NETWORK_PASSPHRASE` | `required` | Canonical network passphrase matching STELLAR_NETWORK. | `Test SDF Network ; September 2015` |
| `CONTRACT_ID` | `optional` | Default deployed niffyinsure contract ID for the active network. | — |
| `DEFAULT_TOKEN_CONTRACT_ID` | `optional` | Default SEP-41 token contract ID used when no asset override is supplied. | — |
| `SOROBAN_RPC_URL_TESTNET` | `optional` | Optional per-network RPC override for testnet. | — |
| `SOROBAN_RPC_URL_MAINNET` | `optional` | Optional per-network RPC override for mainnet. | — |
| `SOROBAN_RPC_URL_FUTURENET` | `optional` | Optional per-network RPC override for futurenet. | — |
| `HORIZON_URL_TESTNET` | `optional` | Optional per-network Horizon override for testnet. | — |
| `HORIZON_URL_MAINNET` | `optional` | Optional per-network Horizon override for mainnet. | — |
| `HORIZON_URL_FUTURENET` | `optional` | Optional per-network Horizon override for futurenet. | — |
| `CONTRACT_ID_TESTNET` | `optional` | Optional per-network contract override for testnet. | — |
| `CONTRACT_ID_MAINNET` | `conditional` | Optional per-network contract override for mainnet. | — |
| `CONTRACT_ID_FUTURENET` | `optional` | Optional per-network contract override for futurenet. | — |
| `DEFAULT_TOKEN_CONTRACT_ID_TESTNET` | `optional` | Optional per-network default token contract override for testnet. | — |
| `DEFAULT_TOKEN_CONTRACT_ID_MAINNET` | `optional` | Optional per-network default token contract override for mainnet. | — |
| `DEFAULT_TOKEN_CONTRACT_ID_FUTURENET` | `optional` | Optional per-network default token contract override for futurenet. | — |
| `INDEXER_GAP_ALERT_THRESHOLD_LEDGERS` | `required` | Alert when chain head minus last processed ledger exceeds this value. | `100` |
| `INDEXER_GAP_ALERT_COOLDOWN_MS` | `required` | Minimum milliseconds between repeated indexer gap alerts. | `3600000` |
| `INDEXER_BATCH_SIZE` | `optional` | Max ledger events fetched per Soroban RPC call (1–100, default 50). | `50` |
| `MAX_BACKFILL_LEDGER_RANGE` | `optional` | Maximum ledger range allowed per backfill request. Requests exceeding this are rejected before any jobs are created. | `100000` |
| `HORIZON_API_KEY` | `optional` | Optional Horizon API key for managed providers that require one. *(secret)* | — |

## IPFS

| Variable | Required | Description | Default |
|---|---|---|---|
| `IPFS_PROVIDER` | `required` | IPFS provider implementation to use. | `mock` |
| `PINATA_API_KEY` | `conditional` | Pinata API key when IPFS_PROVIDER=pinata. *(secret)* | — |
| `PINATA_API_SECRET` | `conditional` | Pinata API secret when IPFS_PROVIDER=pinata. *(secret)* | — |
| `PINATA_GATEWAY_URL` | `required` | Gateway base URL used for Pinata-backed retrievals. | `https://gateway.pinata.cloud/ipfs` |
| `IPFS_MAX_FILE_SIZE` | `required` | Maximum allowed IPFS upload size in bytes. | `52428800` |
| `IPFS_MIN_FILE_SIZE` | `required` | Minimum allowed IPFS upload size in bytes. | `1` |
| `IPFS_STRIP_EXIF` | `required` | Strip EXIF metadata from supported uploads before pinning. | `true` |
| `IPFS_GATEWAY` | `required` | Public gateway base used for viewing claim evidence. | `https://ipfs.io` |
| `ALLOWED_IPFS_GATEWAYS` | `optional` | Comma-separated list of allowed IPFS gateway hostnames for evidence URL validation. Defaults to the built-in list when empty. Changes take effect on next deploy (no restart needed for env-only changes). | `ipfs.io,cloudflare-ipfs.com,gateway.pinata.cloud,dweb.link,nftstorage.link` |
| `IPFS_PROJECT_ID` | `optional` | Legacy IPFS project identifier kept for compatibility. *(secret)* | — |
| `IPFS_PROJECT_SECRET` | `optional` | Legacy IPFS project secret kept for compatibility. *(secret)* | — |

## Auth

| Variable | Required | Description | Default |
|---|---|---|---|
| `JWT_SECRET` | `required` | HMAC signing secret for user/admin JWTs. Rotate independently per environment. *(secret)* | `replace-with-64-byte-base64url-key` |
| `JWT_EXPIRES_IN` | `required` | JWT access token lifetime. | `7d` |
| `JWT_REFRESH_EXPIRES_IN` | `required` | Refresh token lifetime for legacy auth surfaces. | `30d` |
| `JWT_ISSUER` | `required` | JWT issuer claim. | `niffyinsure` |
| `JWT_AUDIENCE` | `required` | JWT audience claim. | `niffyinsure-api` |
| `ADMIN_TOKEN` | `required` | Bootstrap/admin automation token used by operational surfaces. *(secret)* | `replace-with-long-random-admin-token` |
| `AUTH_DOMAIN` | `required` | Human-readable domain embedded in wallet challenge messages. | `app.niffyinsure.local` |
| `NONCE_TTL_SECONDS` | `required` | Wallet login challenge lifetime in seconds. | `300` |
| `PAGINATION_HMAC_SECRET` | `optional` | HMAC secret for tamper-resistant pagination cursors. *(secret)* | — |
| `JWT_SECRET_NEXT` | `optional` | Incoming JWT signing key for zero-downtime rotation overlap. Set to the new key while JWT_SECRET still holds the current key. Tokens signed by either key are accepted during the overlap window. Remove after all tokens signed with the old JWT_SECRET have expired. *(secret)* | — |

## HTTP

| Variable | Required | Description | Default |
|---|---|---|---|
| `FRONTEND_ORIGINS` | `required` | Comma-separated public frontend origins allowed by CORS. | `http://localhost:3001` |
| `CORS_ALLOWED_ORIGINS` | `optional` | Legacy alias for comma-separated public frontend CORS origins. | `http://localhost:3001` |
| `ADMIN_CORS_ORIGINS` | `optional` | Comma-separated admin UI origins allowed by CORS. | `http://localhost:3002` |

## Compliance

| Variable | Required | Description | Default |
|---|---|---|---|
| `BLOCKED_COUNTRIES` | `optional` | Comma-separated ISO 3166-1 alpha-2 country codes blocked from policy initiation (geo-compliance). Empty = no blocking. | `KP,IR,CU` |

## Observability

| Variable | Required | Description | Default |
|---|---|---|---|
| `LOG_LEVEL` | `required` | Minimum application log level. | `info` |

## Caching

| Variable | Required | Description | Default |
|---|---|---|---|
| `CACHE_TTL_SECONDS` | `required` | Default cache TTL in seconds for cache-backed reads. | `60` |
| `QUOTE_SIMULATION_CACHE_ENABLED` | `required` | Enable Redis caching for successful quote simulations. | `true` |
| `QUOTE_SIMULATION_CACHE_TTL_SECONDS` | `required` | TTL for cached quote simulation results in seconds. | `30` |
| `ALLOWED_ASSETS_REFRESH_INTERVAL_MS` | `optional` | Base refresh interval for allowed assets cache in milliseconds. | `300000` |
| `ALLOWED_ASSETS_REFRESH_JITTER_MS` | `optional` | Randomized jitter added to refresh interval to avoid thundering herd (in milliseconds). | `60000` |

## Support

| Variable | Required | Description | Default |
|---|---|---|---|
| `CAPTCHA_PROVIDER` | `required` | CAPTCHA provider for public support/contact forms. | `turnstile` |
| `CAPTCHA_SECRET_KEY` | `required` | Server-side CAPTCHA verification secret. *(secret)* | `dev-skip` |
| `CAPTCHA_SITE_KEY` | `optional` | Public CAPTCHA site key exposed to the frontend. | — |
| `IP_HASH_SALT` | `required` | Salt used when hashing IP addresses for privacy-safe deduplication. *(secret)* | `replace-with-random-hex` |

## Multi-tenancy

| Variable | Required | Description | Default |
|---|---|---|---|
| `TENANT_RESOLUTION_ENABLED` | `required` | Enable tenant resolution from hostnames/headers. | `false` |
| `TENANT_BASE_DOMAIN` | `required` | Base domain used for subdomain-based tenant resolution. | `niffyinsur.com` |

## Operations

| Variable | Required | Description | Default |
|---|---|---|---|
| `DATA_RETENTION_DAYS` | `required` | Days to retain soft-deleted rows before purge jobs hard-delete them. | `730` |
| `INDEXER_RETENTION_DAYS` | `required` | Days to keep RawEvent and inactive LedgerCursor rows before pruning (issue #897). | `90` |
| `SSE_MAX_CONNECTIONS` | `required` | Maximum concurrent SSE connections. | `500` |
| `SOLVENCY_MONITORING_ENABLED` | `required` | Enable scheduled solvency monitoring. | `true` |
| `SOLVENCY_CRON_EXPRESSION` | `required` | Cron expression for solvency monitoring runs. | `0 */15 * * * *` |
| `SOLVENCY_BUFFER_THRESHOLD_STROOPS` | `required` | Minimum treasury buffer before solvency warnings fire. | `0` |
| `SOLVENCY_SIMULATION_SOURCE_ACCOUNT` | `optional` | Optional Stellar account used for solvency simulation calls. | — |
| `SOLVENCY_TENANT_ID` | `optional` | Optional tenant identifier to scope solvency monitoring. | — |
| `SOLVENCY_ALERT_WEBHOOK_URL` | `optional` | Webhook URL that receives solvency alert notifications. *(secret)* | — |
| `SOLVENCY_ALERT_WEBHOOK_SECRET` | `optional` | Shared secret sent with solvency alert webhooks. *(secret)* | — |
| `IPFS_PIN_CHECK_ENABLED` | `optional` | Enable the scheduled IPFS pinning status check job (issue #896). | `true` |
| `IPFS_PIN_CHECK_CRON` | `optional` | Cron expression for the IPFS pin check job (default: 02:00 daily). | `0 2 * * *` |
| `IPFS_PIN_CHECK_ALERT_WEBHOOK_URL` | `optional` | Webhook URL for ops alerts when a CID is no longer pinned. *(secret)* | — |
| `IPFS_PIN_CHECK_ALERT_WEBHOOK_SECRET` | `optional` | Shared secret sent with IPFS pin check alert webhooks. *(secret)* | — |
| `WASM_DRIFT_WEBHOOK_URL` | `optional` | Webhook URL that receives wasm drift alerts. *(secret)* | — |
| `WASM_DRIFT_WEBHOOK_SECRET` | `optional` | Shared secret sent with wasm drift alerts. *(secret)* | — |
| `DEPLOYMENT_REGISTRY_PATH` | `required` | Path to the contract deployment registry JSON file. | `contracts/deployment-registry.json` |
| `NIFFYINSURE_EXPECTED_WASM_HASH` | `optional` | Expected SHA-256 hash of the authorised niffyinsure wasm artifact. | — |
| `DISABLE_REINDEX_WORKER` | `required` | Disable the legacy reindex worker in environments where it should not start. | `0` |
| `RENEWAL_REMINDER_CRON` | `required` | Cron expression for renewal reminder background jobs. | `0 * * * *` |

## Database

| Variable | Required | Description | Default |
|---|---|---|---|
| `DB_POOL_MAX` | `required` | Maximum Prisma connection pool size. | `10` |
| `DB_POOL_MIN` | `required` | Minimum warm Prisma connections. | `2` |
| `DB_POOL_IDLE_TIMEOUT_MS` | `required` | Idle connection reclaim timeout in milliseconds. | `30000` |
| `DB_POOL_CONNECTION_TIMEOUT_MS` | `required` | Maximum time to wait for a free DB connection in milliseconds. | `5000` |
| `DB_SLOW_QUERY_MS` | `required` | Warn when an individual DB query exceeds this latency threshold. | `250` |
| `DB_CONNECT_MAX_ATTEMPTS` | `required` | Max $connect() attempts with exponential backoff before startup fails (issue #894). | `5` |
| `DB_CONNECT_INITIAL_DELAY_MS` | `required` | Initial retry delay in ms for DB connection backoff (doubles each attempt). | `500` |
| `DB_CONNECT_MAX_DELAY_MS` | `required` | Maximum retry delay cap in ms for DB connection backoff. | `30000` |

## GraphQL

| Variable | Required | Description | Default |
|---|---|---|---|
| `GRAPHQL_ENABLED` | `required` | Enable the GraphQL endpoint. | `true` |
| `GRAPHQL_PATH` | `required` | HTTP path mounted for GraphQL requests. | `/graphql` |
| `GRAPHQL_INTROSPECTION_IN_PRODUCTION` | `required` | Allow GraphQL schema introspection when NODE_ENV=production. | `false` |
| `GRAPHQL_MAX_DEPTH` | `required` | Maximum allowed GraphQL selection depth. | `8` |
| `GRAPHQL_MAX_COMPLEXITY` | `required` | Maximum estimated GraphQL query complexity. | `250` |
| `MAX_QUERY_DEPTH` | `optional` | Maximum GraphQL selection depth (overrides GRAPHQL_MAX_DEPTH when set). | `8` |
| `MAX_QUERY_COMPLEXITY` | `optional` | Maximum GraphQL query complexity score (overrides GRAPHQL_MAX_COMPLEXITY when set). | `250` |
| `GRAPHQL_RATE_LIMIT_MAX` | `required` | Maximum GraphQL operations allowed per rate-limit window. | `60` |
| `GRAPHQL_RATE_LIMIT_WINDOW_MS` | `required` | GraphQL rate-limit window in milliseconds. | `60000` |
| `GRAPHQL_SLOW_OPERATION_MS` | `required` | Warn when a GraphQL operation exceeds this latency threshold. | `750` |
| `GRAPHQL_PERSISTED_QUERIES_ENABLED` | `required` | Enable Apollo-style automatic persisted queries. | `false` |
| `GRAPHQL_PERSISTED_QUERIES_ONLY` | `required` | Restrict production to pre-approved query hashes. When true, requests without an allowlisted sha256Hash are rejected. Set to false in development to allow arbitrary queries. | `false` |
| `GRAPHQL_PERSISTED_QUERY_TTL_SECONDS` | `required` | Persisted GraphQL query cache TTL in seconds. | `86400` |
| `GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT` | `required` | Default nested policy.claims page size. | `10` |
| `GRAPHQL_POLICY_CLAIMS_MAX_LIMIT` | `required` | Maximum nested policy.claims page size. | `25` |

## Notifications

| Variable | Required | Description | Default |
|---|---|---|---|
| `SMTP_HOST` | `required` | SMTP host for outbound email notifications. | `127.0.0.1` |
| `SMTP_PORT` | `required` | SMTP port for outbound email notifications. | `1025` |
| `SMTP_USER` | `optional` | SMTP username when authenticated mail delivery is enabled. *(secret)* | — |
| `SMTP_PASS` | `optional` | SMTP password when authenticated mail delivery is enabled. *(secret)* | — |
| `SMTP_FROM` | `required` | From address used for outbound notification emails. | `no-reply@niffyinsure.local` |
| `TELEGRAM_BOT_TOKEN` | `optional` | Telegram Bot API token for optional claim notifications. *(secret)* | — |
| `DISCORD_WEBHOOK_URL` | `optional` | Discord webhook URL for optional claim notifications. *(secret)* | — |

## Feature flags

| Variable | Required | Description | Default |
|---|---|---|---|
| `FEATURE_FLAGS_JSON` | `optional` | JSON object containing backend feature flags. | `{"ramp":false}` |
| `FEATURE_FLAGS_DISABLED_STATUS` | `required` | HTTP status returned when a feature flag is disabled. | `404` |

## Ramp

| Variable | Required | Description | Default |
|---|---|---|---|
| `RAMP_URL` | `optional` | Base URL for the optional fiat on-ramp integration. | — |
| `RAMP_ALLOWED_REGIONS` | `optional` | Comma-separated ISO region codes where the on-ramp is allowed. | — |
| `RAMP_UTM_SOURCE` | `required` | UTM source appended to ramp URLs. | `niffyinsure` |
| `RAMP_UTM_MEDIUM` | `required` | UTM medium appended to ramp URLs. | `app` |
| `RAMP_UTM_CAMPAIGN` | `required` | UTM campaign appended to ramp URLs. | `onramp` |

## Webhooks

| Variable | Required | Description | Default |
|---|---|---|---|
| `WEBHOOK_SECRET_GITHUB` | `optional` | GitHub webhook secret for signature verification. *(secret)* | — |
| `WEBHOOK_SECRET_STRIPE` | `optional` | Stripe webhook secret for signature verification. *(secret)* | — |
| `WEBHOOK_SECRET_GENERIC` | `optional` | Generic webhook secret for signature verification. *(secret)* | — |
| `WEBHOOK_IP_ALLOWLIST_GITHUB` | `optional` | Optional comma-separated IP allowlist for GitHub webhooks. | — |
| `WEBHOOK_IP_ALLOWLIST_STRIPE` | `optional` | Optional comma-separated IP allowlist for Stripe webhooks. | — |
| `WEBHOOK_IP_ALLOWLIST_GENERIC` | `optional` | Optional comma-separated IP allowlist for generic webhooks. | — |
| `CLAIM_FILED_WEBHOOK_URLS` | `optional` | Comma-separated URLs to receive outbound claim.filed webhook deliveries. | `https://example.com/hooks/claim-filed` |
| `VOTE_CAST_WEBHOOK_URLS` | `optional` | Comma-separated URLs to receive outbound vote.cast webhook deliveries. | `https://example.com/hooks/vote-cast` |
| `TREASURY_ALERT_WEBHOOK_URLS` | `optional` | Comma-separated URLs to receive treasury balance-low alert webhooks. | `https://example.com/hooks/treasury-alert` |
| `MAX_OUTBOUND_WEBHOOK_SIZE_BYTES` | `optional` | Maximum payload size for outbound webhooks in bytes. Oversized payloads are rejected. | `1048576` |
| `WEBHOOK_VERIFICATION_TIMEOUT_MS` | `optional` | Timeout in milliseconds for webhook verification challenges. After this, the challenge expires. | `300000` |
| `WEBHOOK_MAX_VERIFICATION_ATTEMPTS` | `optional` | Maximum number of attempts to send verification challenge before marking webhook inactive. | `3` |

## Admin

| Variable | Required | Description | Default |
|---|---|---|---|
| `ADMIN_ALLOWED_CIDRS` | `optional` | Optional comma-separated CIDR allowlist for admin endpoints. Supports IPv4 (e.g. "10.0.0.0/8,192.168.1.0/24") and IPv6. Empty = all IPs allowed (backward compatible default). | `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` |

## URLs

| Variable | Required | Description | Default |
|---|---|---|---|
| `API_BASE_URL` | `required` | Base URL of the API, used in webhook verification links and other features. | `https://api.example.com` |

## Queues

| Variable | Required | Description | Default |
|---|---|---|---|
| `TX_SUBMIT_QUEUE_MAX_DEPTH` | `optional` | Maximum number of pending jobs in the tx-submit queue before new submissions are rejected with 429 backpressure. Prevents unbounded queue growth and delays for all users. | `1000` |
| `QUEUE_CONCURRENCY_MAP` | `optional` | Per-queue BullMQ worker concurrency levels: comma-separated "queue-name=N" pairs. Queues not specified use defaults: tx-submit=1 (nonce-safe), claim-events=5, claim-payouts=3. Example: "tx-submit=1,claim-events=10,claim-payouts=5" | `tx-submit=1,claim-events=5,claim-payouts=3` |
| `QUEUE_RETRY_MAP` | `optional` | Per-queue BullMQ retry configuration. Format: semicolon-separated "queue-name=maxAttempts,backoffType,initialDelayMs" entries. backoffType must be "exponential" or "fixed". Queues not specified use documented defaults. Example: "tx-submit=3,exponential,2000;webhooks=7,fixed,5000" | — |

## Evidence uploads

| Variable | Required | Description | Default |
|---|---|---|---|
| `EVIDENCE_MAX_BYTES` | `optional` | Maximum allowed claim evidence file size in bytes. Defaults to 10 MB. | `10485760` |
| `EVIDENCE_UPLOAD_RATE_LIMIT` | `optional` | Maximum evidence uploads per wallet per rate-limit window. | `5` |
| `EVIDENCE_UPLOAD_RATE_LIMIT_WINDOW_SECONDS` | `optional` | Evidence upload rate-limit window in seconds. | `3600` |

## Log aggregation

| Variable | Required | Description | Default |
|---|---|---|---|
| `LOG_SHIPPING_URL` | `optional` | Loki-compatible push endpoint for centralised log shipping. When set, Winston ships structured JSON logs to this URL in addition to the console. Leave empty to disable. Example: http://loki:3100/loki/api/v1/push | — |
| `LOG_SHIPPING_AUTH_TOKEN` | `optional` | Bearer token sent in the Authorization header when pushing logs to the aggregation endpoint. *(secret)* | — |
| `LOG_SHIPPING_FLUSH_INTERVAL_MS` | `optional` | Milliseconds between log buffer flushes to the remote aggregation endpoint. | `5000` |
| `LOG_SHIPPING_BATCH_SIZE` | `optional` | Maximum log entries buffered before a flush is forced regardless of the interval. | `100` |
| `LOG_RETENTION_DAYS` | `optional` | Intended log retention period in days. Informational label sent to the aggregator — actual retention is enforced by the Loki deployment configuration. | `30` |
