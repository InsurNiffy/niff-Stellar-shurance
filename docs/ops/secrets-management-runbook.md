# Secrets Management Runbook

**Owner:** Platform Engineering  
**Security approver:** Security / Ops  
**Review cadence:** Quarterly and after every material secret rotation

## Policy

- Store production secrets in a managed backend such as HashiCorp Vault, AWS SSM Parameter Store / Secrets Manager, or Kubernetes Secrets.
- Keep secrets separate per environment. `development`, `staging`, and `production` must never share JWT keys, database credentials, IPFS tokens, webhook secrets, or RPC API keys.
- Provision least-privilege database users. The application write path should use a dedicated app user with only the permissions it needs. Reporting/analytics should use a separate read-only replica account when available.
- Never print resolved secret values in application logs, CI logs, or screenshots. Debug mode does not override this rule.
- Keep [`backend/.env.example`](/home/json/Desktop/Drips/niff-Stellar-shurance/backend/.env.example) current through `npm run env:example:generate` and verify drift in CI with `npm run env:example:check`.

## Required secret inventory

| Secret | Owner | Frequency | Notes |
|---|---|---|---|
| `JWT_SECRET` | Platform Engineering | Every 90 days and after any auth incident | Separate secret per environment |
| `DATABASE_URL` credentials | Platform Engineering + DBA/Ops | Every 90 days | Use dedicated app user; rotate reader creds separately |
| `PINATA_API_KEY` / `PINATA_API_SECRET` | Platform Engineering | Every 90 days or on vendor/user change | Only when `IPFS_PROVIDER=pinata` |
| `HORIZON_API_KEY` / RPC vendor key | Platform Engineering | Every 90 days or on vendor request | Only when a managed RPC/Horizon provider requires one |
| `ADMIN_TOKEN` | Platform Engineering | Every 30 days | Break-glass/admin automation only |
| `CAPTCHA_SECRET_KEY` | Platform Engineering | Every 180 days | Separate secret from public site key |
| `IP_HASH_SALT` | Platform Engineering | Annually or after suspected disclosure | Treated as sensitive because it protects pseudonymization |
| Webhook secrets (`WEBHOOK_SECRET_*`, `*_WEBHOOK_SECRET`) | Platform Engineering | Every 90 days | Rotate together with upstream provider where applicable |

## Rotation checklist

- [ ] Open a ticket with rotation scope, owner, approver, environment, and maintenance window.
- [ ] Generate the replacement secret locally or in the secrets manager using a secure RNG.
- [ ] Store the new value in the target environment only.
- [ ] Restart/redeploy workloads that consume the secret.
- [ ] Run a smoke test for auth, DB connectivity, IPFS upload, and RPC access as applicable.
- [ ] Revoke or delete the previous credential after cutover.
- [ ] Record completion in the drill log below, including who verified it.

## JWT signing keys

### Generate

```bash
cd backend
npm run secrets:generate:jwt -- --output ./jwt-secret.env
```

This writes a `JWT_SECRET=...` payload with file mode `600`. Copy the value into Vault/SSM/Kubernetes Secrets and delete the temporary file after import.

### Rotate

1. Generate a new key with `npm run secrets:generate:jwt`.
2. Write the new value to the target environment secret backend.
3. Redeploy all API instances in that environment so every node signs/verifies with the same key.
4. Expect existing JWT sessions to become invalid because the current implementation uses a single active HMAC key. Schedule this during a maintenance window if user re-authentication would be disruptive.
5. Verify fresh wallet/admin login and a protected API call.
6. Record the change in the drill log.

## Database credentials

1. Create a new dedicated app user with the same least-privilege grants as the current user.
2. Update `DATABASE_URL` in the target environment secret backend.
3. Redeploy the API and confirm migrations, health checks, and write paths succeed.
4. Decommission the previous credential after connection drain completes.
5. If reporting jobs exist, rotate replica/read-only credentials separately and confirm they do not have write grants.

## IPFS API tokens

1. Create or request a new Pinata/API token scoped only to the required project and actions.
2. Update `PINATA_API_KEY` and `PINATA_API_SECRET` in the target environment.
3. Redeploy and test one upload plus one retrieval.
4. Revoke the old token from the provider console.

## RPC API keys

1. Create a replacement key in the managed RPC/Horizon vendor console with the narrowest allowed origin/project scope.
2. Update the environment-specific secret (`HORIZON_API_KEY` or the vendor-specific RPC token) in the secret backend.
3. Redeploy and verify health checks plus one live contract read.
4. Revoke the old key and confirm traffic continues without rate-limit/auth errors.

## Suspected leak response

1. Rotate the affected secret immediately in the impacted environment.
2. Search local history for the leaked identifier/value shape.

```bash
git log --all --oneline -- backend/.env.example
git log --all -S 'JWT_SECRET' -- backend docs .github
rg -n 'JWT_SECRET|PINATA_API_SECRET|DATABASE_URL|ADMIN_TOKEN' .
```

3. If available, run your standard secret scanner over the full history (`gitleaks`, GitHub secret scanning, or equivalent).
4. Invalidate the exposed credential at the provider.
5. Document impact, timeline, and follow-up actions in the incident ticket.

## Drill log

| Date | Environment | Scope | Verified by | Notes |
|---|---|---|---|---|
| 2026-03-29 | local dev | JWT key generation script dry run | Codex | `npm run secrets:generate:jwt -- --output /tmp/niffy-jwt-secret.env` produced a mode `600` file and confirmed the generation workflow |
| _Pending first staged drill_ | staging | Full rotation runbook | _TBD_ | Record the first end-to-end rehearsal here |
