# Secrets Management Runbook

**Owner:** Platform Engineering  
**Security approver:** Security / Ops  
**Review cadence:** Quarterly and after every material secret rotation

---

## Policy

- Store production secrets in a managed backend such as HashiCorp Vault, AWS SSM Parameter Store / Secrets Manager, or Kubernetes Secrets.
- Keep secrets separate per environment. `development`, `staging`, and `production` must never share JWT keys, database credentials, IPFS tokens, webhook secrets, or RPC API keys.
- Provision least-privilege database users. The application write path should use a dedicated app user with only the permissions it needs. Reporting/analytics should use a separate read-only replica account when available.
- Never print resolved secret values in application logs, CI logs, or screenshots. Debug mode does not override this rule.
- Keep [`backend/.env.example`](../../backend/.env.example) current through `npm run env:example:generate` and verify drift in CI with the `env-example-drift` workflow (`.github/workflows/env-example-drift.yml`).

---

## Automated reminders

The `.github/workflows/secrets-rotation-reminders.yml` workflow runs every Monday at 09:00 UTC. It reads last-rotated dates from `docs/ops/.secret-rotation-dates.json` and opens a GitHub issue labelled `secrets-rotation` when any secret is overdue or within 14 days of its deadline.

**After every rotation:** update `docs/ops/.secret-rotation-dates.json` with the new date and commit it.

---

## Required secret inventory

| Secret | Owner | Frequency | Notes |
|---|---|---|---|
| `JWT_SECRET` | Platform Engineering | Every 90 days and after any auth incident | Separate secret per environment |
| `JWT_SECRET_NEXT` | Platform Engineering | During rotation overlap only | Remove after overlap window (≥ `JWT_EXPIRES_IN`) |
| `DATABASE_URL` credentials | Platform Engineering + DBA/Ops | Every 90 days | Use dedicated app user; rotate reader creds separately |
| `PINATA_API_KEY` / `PINATA_API_SECRET` | Platform Engineering | Every 90 days or on vendor/user change | Only when `IPFS_PROVIDER=pinata` |
| `HORIZON_API_KEY` / RPC vendor key | Platform Engineering | Every 90 days or on vendor request | Only when a managed RPC/Horizon provider requires one |
| `ADMIN_TOKEN` | Platform Engineering | Every 30 days | Break-glass/admin automation only |
| `CAPTCHA_SECRET_KEY` | Platform Engineering | Every 180 days | Separate secret from public site key |
| `IP_HASH_SALT` | Platform Engineering | Annually or after suspected disclosure | Treated as sensitive because it protects pseudonymization |
| Webhook secrets (`WEBHOOK_SECRET_*`) | Platform Engineering | Every 90 days | Rotate together with upstream provider where applicable |

---

## General rotation checklist

- [ ] Open a ticket with rotation scope, owner, approver, environment, and maintenance window.
- [ ] Generate the replacement secret locally or in the secrets manager using a secure RNG.
- [ ] Store the new value in the target environment only.
- [ ] Follow the secret-specific procedure below (restart/redeploy as documented).
- [ ] Run the smoke tests listed for that secret type.
- [ ] Revoke or delete the previous credential after cutover.
- [ ] Update `docs/ops/.secret-rotation-dates.json` with today's date and commit.
- [ ] Record completion in the drill log at the bottom of this file.

---

## JWT signing keys — zero-downtime rotation

The API supports a dual-key overlap period via `JWT_SECRET_NEXT`. During the overlap, tokens signed by either key are accepted, so active user sessions are not invalidated.

### Generate a new key

```bash
cd backend
npm run secrets:generate:jwt -- --output /tmp/niffy-jwt-next.env
# Inspect the file (mode 600), then import the value into your secrets manager.
cat /tmp/niffy-jwt-next.env
rm /tmp/niffy-jwt-next.env
```

### Rotation procedure (zero-downtime)

**Phase 1 — overlap (no session disruption)**

1. Generate a new key as above.
2. Set `JWT_SECRET_NEXT=<new key>` in the target environment secret backend. Leave `JWT_SECRET` unchanged.
3. Redeploy all API instances. Both keys are now accepted for verification; new tokens are still signed with `JWT_SECRET`.
4. Verify: obtain a token with the current key and confirm it is still accepted.

**Phase 2 — promote (after overlap window)**

Wait at least as long as `JWT_EXPIRES_IN` (default 7 days) so all tokens signed with the old key have expired.

5. Set `JWT_SECRET=<new key>` (the value that was in `JWT_SECRET_NEXT`).
6. Unset / clear `JWT_SECRET_NEXT`.
7. Redeploy all API instances.
8. Verify: obtain a fresh token and confirm it is accepted. Confirm an old token (signed with the previous key) is now rejected with 401.

### Smoke tests

```bash
# 1. Health check passes after redeploy
curl -sf http://localhost:3000/health | jq .

# 2. Wallet auth challenge issues successfully
curl -sf -X POST http://localhost:3000/auth/challenge \
  -H 'Content-Type: application/json' \
  -d '{"publicKey":"GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"}' | jq .

# 3. Protected endpoint rejects missing token
curl -sf http://localhost:3000/api/policies \
  -w '\nHTTP %{http_code}\n' | grep 'HTTP 401'

# 4. Protected endpoint accepts a valid token
TOKEN=$(curl -sf -X POST http://localhost:3000/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"publicKey":"...","nonce":"...","signature":"..."}' | jq -r .token)
curl -sf http://localhost:3000/api/policies \
  -H "Authorization: Bearer $TOKEN" | jq .
```

---

## Database credentials

### Rotation procedure

1. Create a new dedicated app user with the same least-privilege grants as the current user:

```sql
CREATE USER niffy_app_new WITH PASSWORD '<new-password>';
GRANT CONNECT ON DATABASE niffyinsure TO niffy_app_new;
GRANT USAGE ON SCHEMA public TO niffy_app_new;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO niffy_app_new;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO niffy_app_new;
```

2. Update `DATABASE_URL` in the target environment secret backend.
3. Redeploy the API.
4. Decommission the previous credential after connection drain completes:

```sql
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM niffy_app_old;
DROP USER niffy_app_old;
```

5. If reporting jobs exist, rotate replica/read-only credentials separately and confirm they do not have write grants.

### Smoke tests

```bash
# Health check confirms DB connectivity
curl -sf http://localhost:3000/health | jq '.database'

# A read-path API call succeeds
curl -sf http://localhost:3000/api/claims?page=1 | jq '.totalCount'

# Confirm old user is rejected (run from psql)
psql "postgresql://niffy_app_old:<old-password>@localhost:5432/niffyinsure" -c '\l'
# Expected: FATAL: password authentication failed
```

---

## IPFS API tokens (Pinata)

### Rotation procedure

1. Create a new Pinata API key scoped only to the required project and actions in the Pinata console.
2. Update `PINATA_API_KEY` and `PINATA_API_SECRET` in the target environment.
3. Redeploy and run smoke tests.
4. Revoke the old token from the Pinata console.

### Smoke tests

```bash
# Upload a test file via the API
curl -sf -X POST http://localhost:3000/api/ipfs/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@/tmp/test-evidence.txt' | jq .cid

# Retrieve the uploaded file
CID=$(curl -sf ... | jq -r .cid)
curl -sf "https://gateway.pinata.cloud/ipfs/$CID" -o /dev/null -w '%{http_code}\n'
# Expected: 200
```

---

## RPC / Horizon API keys

### Rotation procedure

1. Create a replacement key in the managed RPC/Horizon vendor console with the narrowest allowed origin/project scope.
2. Update `HORIZON_API_KEY` (or the vendor-specific RPC token) in the secret backend.
3. Redeploy and run smoke tests.
4. Revoke the old key and confirm traffic continues without rate-limit/auth errors.

### Smoke tests

```bash
# Health check confirms Horizon connectivity
curl -sf http://localhost:3000/health | jq '.horizon'

# A live contract read succeeds
curl -sf http://localhost:3000/api/chain/latest-ledger | jq .sequence
```

---

## Admin token

### Rotation procedure

1. Generate a new token (minimum 32 bytes of entropy):

```bash
openssl rand -base64 48
```

2. Update `ADMIN_TOKEN` in the target environment secret backend.
3. Redeploy the API.
4. Verify admin-only endpoints reject the old token and accept the new one.

### Smoke tests

```bash
# Old token is rejected
curl -sf http://localhost:3000/admin/health \
  -H "Authorization: Bearer <old-token>" -w '\nHTTP %{http_code}\n' | grep 'HTTP 401'

# New token is accepted
curl -sf http://localhost:3000/admin/health \
  -H "Authorization: Bearer <new-token>" | jq .
```

---

## Webhook secrets

### Rotation procedure

1. Generate a new secret per webhook provider:

```bash
openssl rand -hex 32
```

2. Update the new value in the upstream provider's webhook configuration (GitHub, Stripe, etc.).
3. Update the corresponding `WEBHOOK_SECRET_*` variable in the target environment.
4. Redeploy the API.
5. Send a test webhook from the provider console and confirm it is accepted (HTTP 200).
6. Revoke the old secret from the provider console.

### Smoke tests

```bash
# GitHub: use the "Redeliver" button in the webhook settings to send a recent event.
# Stripe: use the Stripe CLI: stripe trigger payment_intent.created
# Confirm the API logs show "webhook verified" and returns 200.
```

---

## Captcha secret key

### Rotation procedure

1. Generate a new secret key in the Cloudflare Turnstile / hCaptcha dashboard.
2. Update `CAPTCHA_SECRET_KEY` in the target environment.
3. Redeploy the API.
4. Submit a support form and confirm the CAPTCHA verification succeeds.

---

## IP hash salt

### Rotation procedure

> **Note:** Rotating `IP_HASH_SALT` invalidates all existing pseudonymized IP records. Coordinate with the data team before rotating in production.

1. Generate a new salt:

```bash
openssl rand -hex 32
```

2. Update `IP_HASH_SALT` in the target environment.
3. Redeploy the API.
4. Confirm rate-limiting and deduplication features continue to function.

---

## Suspected leak response

1. Rotate the affected secret immediately in the impacted environment following the procedure above.
2. Search local history for the leaked identifier/value shape:

```bash
git log --all --oneline -- backend/.env.example
git log --all -S 'JWT_SECRET' -- backend docs .github
rg -n 'JWT_SECRET|PINATA_API_SECRET|DATABASE_URL|ADMIN_TOKEN' .
```

3. If available, run your standard secret scanner over the full history (`gitleaks`, GitHub secret scanning, or equivalent).
4. Invalidate the exposed credential at the provider.
5. Document impact, timeline, and follow-up actions in the incident ticket.

---

## CI checks

| Check | Workflow | Trigger |
|---|---|---|
| `.env.example` in sync with `env.definitions.ts` | `env-example-drift.yml` | PR / push touching `backend/` |
| Rotation reminders | `secrets-rotation-reminders.yml` | Every Monday 09:00 UTC + manual |

---

## Drill log

| Date | Environment | Scope | Verified by | Notes |
|---|---|---|---|---|
| 2026-03-29 | local dev | JWT key generation script dry run | Codex | `npm run secrets:generate:jwt -- --output /tmp/niffy-jwt-secret.env` produced a mode `600` file and confirmed the generation workflow |
| 2026-04-25 | — | Dual-key JWT rotation implemented | Platform Engineering | `JWT_SECRET_NEXT` added to `env.definitions.ts` and `JwtStrategy`; zero-downtime procedure documented and tested |
| _Pending first staged drill_ | staging | Full rotation runbook end-to-end | _TBD_ | Record the first end-to-end rehearsal here |
