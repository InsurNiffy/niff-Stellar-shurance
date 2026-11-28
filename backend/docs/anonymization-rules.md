# Anonymization Rules (Staging Data Sync)

This document describes how production data is transformed before it is copied
into staging by `StagingDataSyncService`. The goal is production-shaped data
without exposing real user PII.

## Transform categories

- **hashed** — value is replaced with a deterministic HMAC-SHA256 digest
  (keyed with `STAGING_ANONYMIZATION_SECRET`). Deterministic so joins and
  uniqueness constraints still hold, but the original value cannot be recovered.
- **fake** — value is replaced with a generated fake value (faker-style).
- **dropped** — column is set to `NULL` (or the row is excluded entirely).

## Field-by-field rules

### `users`

| Field | Transform | Notes |
| --- | --- | --- |
| `email` | fake | Replaced with `user+<id>@staging.invalid`. Never a production address. |
| `email_normalized` | fake | Derived from the fake email. |
| `display_name` | fake | Replaced with `Staging User <id>`. |
| `password_hash` | dropped | Set to `NULL`; staging logins use seeded test accounts. |
| `phone` | dropped | Set to `NULL`. |
| `wallet_address` | hashed | Deterministic HMAC digest; no raw production address survives. |
| `ip_address` | dropped | Set to `NULL`. |
| `avatar_url` | dropped | Set to `NULL`. |
| `created_at` / `updated_at` | kept | Non-PII timestamps preserved for realistic shape. |

### `wallets`

| Field | Transform | Notes |
| --- | --- | --- |
| `address` | hashed | Deterministic HMAC digest. |
| `label` | fake | Replaced with `Staging Wallet <id>`. |
| `encrypted_private_key` | dropped | Set to `NULL`. |

### `transactions`

| Field | Transform | Notes |
| --- | --- | --- |
| `from_address` | hashed | Deterministic HMAC digest. |
| `to_address` | hashed | Deterministic HMAC digest. |
| `memo` | dropped | Set to `NULL`. |
| `amount` / `asset` / `status` | kept | Non-PII, preserved for realistic testing. |

### `webhook_endpoints`

| Field | Transform | Notes |
| --- | --- | --- |
| `url` | fake | Replaced with `https://staging.invalid/webhook/<id>`. |
| `secret` | dropped | Set to `NULL`; staging endpoints are re-registered. |

### `audit_logs`

| Field | Transform | Notes |
| --- | --- | --- |
| `actor_email` | fake | Replaced with `user+<id>@staging.invalid`. |
| `actor_ip` | dropped | Set to `NULL`. |
| `metadata` | dropped | Set to `NULL` (may contain free-form PII). |

## Scheduling

The sync runs on a configurable cron expression via `STAGING_SYNC_CRON`
(default: `0 3 * * 0` — weekly, Sunday 03:00 UTC). Set
`STAGING_SYNC_ENABLED=false` to disable the job entirely.

## Verification

An integration test (`staging-data-sync.service.spec.ts`) runs the
anonymisation transform over a fixture containing known production-shaped PII
and asserts that no raw email, wallet address, phone, IP, or secret survives.
The same transform is what the PII-check script inspects, so a passing test
implies the anonymised dataset passes the PII check.
