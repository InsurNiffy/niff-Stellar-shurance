# API Error Catalog

Every error response from the NiffyInsure API is an [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) problem detail
(`ProblemDetailDto`, `backend/src/common/errors/problem-detail.dto.ts`), produced by the global
`HttpExceptionFilter`. The source of truth for codes is `backend/src/common/errors/error-catalog.ts`; the live
catalog is also served at `GET /api/v1/errors`.

## Response shape

```json
{
  "type": "/api/v1/errors#CLAIM_NOT_FOUND",
  "title": "Not Found",
  "status": 404,
  "detail": "Claim does not exist.",
  "instance": "/api/v1/claims/42",
  "extensions": {
    "code": "CLAIM_NOT_FOUND",
    "i18nKey": "errors.claims.notFound",
    "requestId": "3f2c…",
    "details": {}
  },
  "data": null,
  "meta": { "statusCode": 404, "timestamp": "…", "path": "/api/v1/claims/42", "requestId": "3f2c…" },
  "errors": [{ "code": "CLAIM_NOT_FOUND", "message": "Claim does not exist.", "i18nKey": "errors.claims.notFound" }]
}
```

| Field | Description |
|---|---|
| `type` | URI reference to the catalog entry. Errors without a catalog code fall back by status (400 → `VALIDATION_ERROR`, 401 → `UNAUTHORIZED`, 403 → `FORBIDDEN`, 404 → `NOT_FOUND`, 429 → `RATE_LIMIT_EXCEEDED`, 500 → `INTERNAL_ERROR`), otherwise `about:blank`. |
| `title` | HTTP reason phrase for `status`. |
| `status` | HTTP status code. |
| `detail` | Human-readable explanation of this occurrence. |
| `instance` | Request path that produced the error. |
| `extensions` | Catalog `code`, `i18nKey`, `requestId` and error-specific `details` (e.g. `retryAfter`). |

`data`, `meta` and `errors` are the legacy envelope, kept for backward compatibility.

## Throwing errors

Use `throw new AppException('CODE', { message?, details? })` instead of `new HttpException()`.
Add new codes as described in `backend/docs/error-catalog.md`, and add the English message for the new
`i18nKey` to `backend/src/common/errors/i18n/en.json` (enforced by `error-catalog.test.ts`).

## Codes

| Code | Status | `type` | i18n key | Description |
|---|---|---|---|---|
| `SIGNATURE_INVALID` | 401 | `/api/v1/errors#SIGNATURE_INVALID` | `errors.auth.signatureInvalid` | Wallet signature verification failed. |
| `NONCE_EXPIRED` | 401 | `/api/v1/errors#NONCE_EXPIRED` | `errors.auth.nonceExpired` | The sign-in nonce has expired; request a new one. |
| `TOKEN_EXPIRED` | 401 | `/api/v1/errors#TOKEN_EXPIRED` | `errors.auth.tokenExpired` | JWT access token has expired. |
| `UNAUTHORIZED` | 401 | `/api/v1/errors#UNAUTHORIZED` | `errors.auth.unauthorized` | Request is not authenticated. |
| `FORBIDDEN` | 403 | `/api/v1/errors#FORBIDDEN` | `errors.auth.forbidden` | Authenticated user lacks permission for this action. |
| `INVALID_WALLET_ADDRESS` | 400 | `/api/v1/errors#INVALID_WALLET_ADDRESS` | `errors.wallet.invalidAddress` | The supplied Stellar address is not valid or does not exist on-chain. |
| `ACCOUNT_NOT_FOUND` | 400 | `/api/v1/errors#ACCOUNT_NOT_FOUND` | `errors.wallet.accountNotFound` | Stellar account not found; fund it with at least 1 XLM. |
| `WRONG_NETWORK` | 400 | `/api/v1/errors#WRONG_NETWORK` | `errors.wallet.wrongNetwork` | RPC network passphrase mismatch. |
| `INSUFFICIENT_BALANCE` | 400 | `/api/v1/errors#INSUFFICIENT_BALANCE` | `errors.wallet.insufficientBalance` | Account does not have enough XLM to cover fees. |
| `TRANSACTION_FAILED` | 400 | `/api/v1/errors#TRANSACTION_FAILED` | `errors.tx.failed` | Stellar transaction was rejected by the network. |
| `TRANSACTION_REJECTED` | 400 | `/api/v1/errors#TRANSACTION_REJECTED` | `errors.tx.rejected` | Transaction was rejected at submission time. |
| `INSUFFICIENT_FEE` | 400 | `/api/v1/errors#INSUFFICIENT_FEE` | `errors.tx.insufficientFee` | Transaction fee is below the network minimum. |
| `SIMULATION_TIMEOUT` | 504 | `/api/v1/errors#SIMULATION_TIMEOUT` | `errors.tx.simulationTimeout` | Soroban simulate_transaction timed out. |
| `SIMULATION_FAILED` | 400 | `/api/v1/errors#SIMULATION_FAILED` | `errors.tx.simulationFailed` | Soroban simulation returned an error. |
| `SIMULATION_DECODE_FAILED` | 500 | `/api/v1/errors#SIMULATION_DECODE_FAILED` | `errors.tx.simulationDecodeFailed` | Could not decode the simulation return value. |
| `CONTRACT_NOT_DEPLOYED` | 503 | `/api/v1/errors#CONTRACT_NOT_DEPLOYED` | `errors.tx.contractNotDeployed` | Smart contract is not deployed on this network. |
| `CONTRACT_NOT_CONFIGURED` | 400 | `/api/v1/errors#CONTRACT_NOT_CONFIGURED` | `errors.tx.contractNotConfigured` | CONTRACT_ID environment variable is not set. |
| `CONTRACT_NOT_INITIALIZED` | 400 | `/api/v1/errors#CONTRACT_NOT_INITIALIZED` | `errors.tx.contractNotInitialized` | Contract is not initialized for this operation. |
| `SUBMISSION_FAILED` | 503 | `/api/v1/errors#SUBMISSION_FAILED` | `errors.tx.submissionFailed` | Failed to submit transaction to the Soroban RPC. |
| `LEDGER_CLOSED` | 400 | `/api/v1/errors#LEDGER_CLOSED` | `errors.tx.ledgerClosed` | Target ledger has already closed. |
| `TIMEOUT_ERROR` | 504 | `/api/v1/errors#TIMEOUT_ERROR` | `errors.tx.timeout` | RPC call timed out. |
| `RPC_UNAVAILABLE` | 503 | `/api/v1/errors#RPC_UNAVAILABLE` | `errors.rpc.unavailable` | Soroban RPC endpoint is unreachable. |
| `POLICY_NOT_FOUND` | 404 | `/api/v1/errors#POLICY_NOT_FOUND` | `errors.policy.notFound` | Policy does not exist. |
| `POLICY_BATCH_TOO_LARGE` | 400 | `/api/v1/errors#POLICY_BATCH_TOO_LARGE` | `errors.policy.batchTooLarge` | Batch request exceeds the maximum allowed policy count. |
| `REGION_BLOCKED` | 451 | `/api/v1/errors#REGION_BLOCKED` | `errors.policy.regionBlocked` | Policy initiation is not available in the requester's region. |
| `CLAIM_NOT_FOUND` | 404 | `/api/v1/errors#CLAIM_NOT_FOUND` | `errors.claim.notFound` | Claim does not exist. |
| `CLAIM_ALREADY_FINALIZED` | 409 | `/api/v1/errors#CLAIM_ALREADY_FINALIZED` | `errors.claim.alreadyFinalized` | Claim has already been finalized and cannot be modified. |
| `CLAIMS_PAUSED` | 503 | `/api/v1/errors#CLAIMS_PAUSED` | `errors.claim.claimsPaused` | Claim operations (including appeals) are paused by the contract admin. |
| `NOT_CLAIMANT` | 403 | `/api/v1/errors#NOT_CLAIMANT` | `errors.appeal.notClaimant` | Only the original claimant may appeal a claim; the calling wallet is a different address. |
| `CLAIM_NOT_REJECTED` | 409 | `/api/v1/errors#CLAIM_NOT_REJECTED` | `errors.appeal.claimNotRejected` | Appeals are only permitted on rejected claims; this claim is in a different status. |
| `APPEAL_ALREADY_SUBMITTED` | 409 | `/api/v1/errors#APPEAL_ALREADY_SUBMITTED` | `errors.appeal.alreadySubmitted` | An appeal has already been recorded for this claim (contract allows one appeal per claim). |
| `APPEAL_WINDOW_CLOSED` | 409 | `/api/v1/errors#APPEAL_WINDOW_CLOSED` | `errors.appeal.windowClosed` | The appeal window closed; the current ledger is past the claim appeal_open_deadline_ledger. |
| `RATE_LIMIT_EXCEEDED` | 429 | `/api/v1/errors#RATE_LIMIT_EXCEEDED` | `errors.rateLimit.exceeded` | Too many requests; retry after the window resets. |
| `VALIDATION_ERROR` | 422 | `/api/v1/errors#VALIDATION_ERROR` | `errors.validation.failed` | Request body failed schema validation. |
| `NOT_FOUND` | 404 | `/api/v1/errors#NOT_FOUND` | `errors.generic.notFound` | Requested resource was not found. |
| `INTERNAL_ERROR` | 500 | `/api/v1/errors#INTERNAL_ERROR` | `errors.generic.internalError` | Unexpected server error. |
