# Vendor Offboarding Checklist

**Owner:** Platform Engineering
**Applies to:** Any retired third-party integration (ramp provider, oracle, notification vendor, RPC/Horizon provider, storage provider, etc.)

Use this checklist whenever a third-party vendor integration is retired or replaced, to ensure no dangling access, credentials, or webhooks remain.

## 1. Credential revocation

- [ ] Identify every credential associated with the vendor (API keys, OAuth tokens, webhook signing secrets) via `docs/ops/secrets-management-runbook.md`'s secret inventory.
- [ ] Revoke/delete the credential on the vendor's dashboard or API.
- [ ] Remove the credential from the secrets manager (Vault / SSM / Kubernetes Secrets) for all environments (development, staging, production).
- [ ] Remove the corresponding entries from `docs/ops/.secret-rotation-dates.json`.
- [ ] Update `backend/.env.example` (and regenerate via `npm run env:example:generate`) to drop the now-unused variables.

## 2. Webhook deregistration

- [ ] List all webhook endpoints registered with the vendor (dashboard, API, or internal `WEBHOOK_SECRET_*` inventory).
- [ ] Delete/deregister each webhook on the vendor side so it stops sending callbacks.
- [ ] Remove or disable the corresponding inbound webhook route/handler in the backend, or confirm it safely no-ops if it can't be removed immediately.
- [ ] Remove `WEBHOOK_SECRET_<VENDOR>` from secrets storage and `.env.example`.

## 3. Configuration cleanup

- [ ] Remove vendor-specific environment variables from all environments and deployment manifests (`docker-compose*.yml`, CI/CD config).
- [ ] Remove vendor references from feature flags, config modules, and provider selection logic (e.g. `IPFS_PROVIDER`, `HORIZON_API_KEY`-style toggles).
- [ ] Remove vendor from monitoring/alerting configuration (Grafana dashboards, Prometheus alerts) if it had dedicated panels/rules.
- [ ] Search the codebase and docs for the vendor's name to catch stale references (`grep -ri "<vendor>"`).
- [ ] Archive or remove vendor-specific runbooks, or mark them clearly as retired with a pointer to the replacement.

## 4. Sign-off

- [ ] Confirm with Security/Ops that no active credential remains (spot-check the vendor's own access-management console).
- [ ] Record the offboarding date and vendor name in this file's dry-run log or an incident/change ticket.
- [ ] Notify any dependent teams (indexer, notifications, admin) that the integration is fully removed.

---

## Dry-run log

| Date | Vendor | Performed by | Result |
|---|---|---|---|
| 2026-07-24 | Pinata (IPFS provider, `PINATA_API_KEY` / `PINATA_API_SECRET`) | martinzhames | Dry-run only, no access revoked. Confirmed: credentials tracked in `docs/ops/secrets-management-runbook.md` secret inventory; `IPFS_PROVIDER=pinata` is the single config toggle controlling usage; no dedicated webhook exists for this vendor (pull-based integration); env vars are documented in `backend/.env.example`. Checklist steps 1 and 3 map cleanly to existing tooling (`env:example:generate`, `.secret-rotation-dates.json`); step 2 is N/A for this vendor. No gaps found. |

This checklist is referenced from the vendor integration documentation in `docs/ops/secrets-management-runbook.md`.
