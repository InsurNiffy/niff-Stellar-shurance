# Error & Support Playbook

## Overview

Every API error response includes a `requestId` (correlation ID) that links the
user-facing error to a specific backend log entry. Support agents should always
ask users for this reference before escalating.

Error codes are defined in `backend/src/common/errors/error-catalog.ts` and
exported to `backend/src/common/errors/error-catalog.json` for frontend i18n.
Run `npm run error-catalog:export` (in `backend/`) to regenerate after changes.

---

## 1. Finding a Correlation ID

### From the UI
Users see the reference in error toasts and inline error messages:
> "Something went wrong. (Ref: `req_abc123`)"

### From the API response body
```json
{
  "statusCode": 500,
  "requestId": "req_abc123",
  "error": "INTERNAL_ERROR",
  "message": "Internal server error"
}
```

### From response headers
```
x-request-id: req_abc123
```

---

## 2. Log Lookup

### NestJS backend (structured JSON logs)
```bash
# Grep by requestId in production logs
grep '"requestId":"req_abc123"' /var/log/app/app.log

# Or with jq
cat /var/log/app/app.log | jq 'select(.requestId == "req_abc123")'
```

### Grafana / Loki
```logql
{app="niffyinsur-backend"} |= "req_abc123"
```

---

## 3. Error Code Reference

All codes are sourced from `backend/src/common/errors/error-catalog.ts`.

### Auth

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `SIGNATURE_INVALID` | 401 | Wallet signature verification failed | Ask user to retry signing |
| `NONCE_EXPIRED` | 401 | Sign-in nonce expired | Ask user to request a new nonce and retry |
| `TOKEN_EXPIRED` | 401 | JWT access token expired | Ask user to reconnect wallet / re-authenticate |
| `UNAUTHORIZED` | 401 | Request not authenticated | Ask user to reconnect wallet |
| `FORBIDDEN` | 403 | Insufficient role/permission | Verify user permissions; escalate if unexpected |

### Wallet / Account

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `INVALID_WALLET_ADDRESS` | 400 | Stellar address invalid or not on-chain | Ask user to verify their wallet address |
| `ACCOUNT_NOT_FOUND` | 400 | Stellar account not found | User needs to fund account with at least 1 XLM |
| `WRONG_NETWORK` | 400 | RPC network passphrase mismatch | Check `SOROBAN_RPC_URL` env var; verify network config |
| `INSUFFICIENT_BALANCE` | 400 | Not enough XLM for fees | User needs to fund wallet |

### Transaction / Contract

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `TRANSACTION_FAILED` | 400 | Stellar tx rejected by network | Check Stellar explorer with tx hash |
| `TRANSACTION_REJECTED` | 400 | Tx rejected at submission | Check Stellar explorer; may be fee or sequence issue |
| `INSUFFICIENT_FEE` | 400 | Fee below network minimum | Resubmit with higher fee |
| `SIMULATION_FAILED` | 400 | Soroban simulation error | Check contract state; may be invalid input |
| `SIMULATION_DECODE_FAILED` | 500 | Could not decode simulation return | Escalate with requestId; likely a contract ABI mismatch |
| `CONTRACT_NOT_DEPLOYED` | 503 | Contract not deployed on this network | Verify `CONTRACT_ID` and network config |
| `CONTRACT_NOT_CONFIGURED` | 400 | `CONTRACT_ID` env var not set | Check deployment environment variables |
| `CONTRACT_NOT_INITIALIZED` | 400 | Contract not initialized | Run contract initialization; check deployment registry |
| `SUBMISSION_FAILED` | 503 | Failed to submit tx to Soroban RPC | Check RPC node health; retry |
| `LEDGER_CLOSED` | 400 | Target ledger already closed | Resubmit transaction |
| `TIMEOUT_ERROR` | 504 | RPC call timed out | Check RPC node latency; retry |
| `RPC_UNAVAILABLE` | 503 | Soroban RPC endpoint unreachable | Check RPC node health; check `SOROBAN_RPC_URL` |

### Policy

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `POLICY_NOT_FOUND` | 404 | Policy does not exist | Verify policy ID; check indexer is up to date |
| `POLICY_BATCH_TOO_LARGE` | 400 | Batch exceeds max policy count | Reduce batch size in request |

### Claims

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `CLAIM_NOT_FOUND` | 404 | Claim does not exist | Verify claim ID; check indexer is up to date |
| `CLAIM_ALREADY_FINALIZED` | 409 | Claim already finalized | Explain to user; no further action possible |

### Rate Limiting

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Wait for window reset; check for abuse patterns |

### Validation

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `VALIDATION_ERROR` | 422 | Request body failed schema validation | Check request payload against API spec |

### Generic

| Code | HTTP | Meaning | Action |
|------|------|---------|--------|
| `NOT_FOUND` | 404 | Resource not found | Verify the resource ID |
| `INTERNAL_ERROR` | 500 | Unexpected server error | Escalate with requestId |

> **Deprecated codes still in circulation:** `SERVER_ERROR` (replaced by `INTERNAL_ERROR`),
> `SOROBAN_RPC_ERROR` (replaced by `RPC_UNAVAILABLE`), `OPEN_CLAIM_EXISTS` (replaced by
> `CLAIM_ALREADY_FINALIZED`). These may appear in responses from older clients or cached
> error messages. Map them to the current codes above for triage purposes.

---

## 4. Stellar Transaction Debugging

1. Extract `transactionHash` from the error details or user report.
2. Look up on Stellar Expert:
   - Testnet: `https://stellar.expert/explorer/testnet/tx/<hash>`
   - Mainnet: `https://stellar.expert/explorer/public/tx/<hash>`
3. Check the result code (e.g. `tx_failed`, `op_underfunded`).
4. Map to the error code table above.

> **Security**: Never ask users to share private keys, seed phrases, or signed
> XDR outside of a verified secure developer tool. These are never required for
> support escalation.

---

## 5. Escalation Path

1. **Tier 1** — User self-service: retry button in UI, reconnect wallet.
2. **Tier 2** — Support agent: collect `requestId`, look up logs, check Stellar explorer.
3. **Tier 3** — Engineering: provide `requestId` + full log context + Stellar tx hash.

---

## 6. PII Policy for Error Events

Anonymized error events forwarded to observability tools **must not** include:
- Wallet addresses (truncate to first 6 + last 4 chars if needed for grouping)
- Email addresses
- IP addresses (hash or omit)
- Private keys, seeds, or signed XDR (never, under any circumstances)

See `backend/src/maintenance/privacy.service.ts` for the data-scrubbing implementation.

---

## 7. Keeping This Playbook Current

When new error codes are added to `error-catalog.ts`:
1. Add a row to the relevant table in section 3 above.
2. Include the HTTP status, a plain-English description, and the recommended support action.
3. Open a PR — required reviewers: **backend-lead** + **ops-lead**.

The CI job `npm run error-catalog:check` (in `backend/`) will fail if any
`new AppException('CODE')` call references a code not in the catalog, preventing
undocumented codes from reaching production.
