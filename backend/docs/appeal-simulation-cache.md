# Appeal simulation Redis cache (#1327)

## Purpose

`POST /api/claims/:id/appeal/simulate` dry-runs `file_appeal` against Soroban so
the wallet UI can fail fast before opening a signing popup. Wallet flows often
call simulate more than once in quick succession (e.g. retry after a transient
error). A short-TTL Redis cache stores **successful** simulation fee metadata
keyed by `(claimId, walletAddress)` to avoid redundant RPC.

## Key design

- **Cache key**: `appeal:sim:v1:{claimId}:{walletAddress}`
- **Stored value**: `{ ok, claimId, walletAddress, minResourceFee, baseFee, totalEstimatedFee, totalEstimatedFeeXlm, currentLedger }`
- **Never cached**:
  - `unsignedXdr` (signing material)
  - Simulation / RPC errors (transient failures must not be pinned)
- **Not used by** `POST /api/claims/:id/appeal/build-transaction` — that path
  always performs a fresh RPC simulation so the returned XDR is never stale.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `APPEAL_SIMULATION_CACHE_ENABLED` | `true` | Set to `false` or `0` to disable read/write |
| `APPEAL_SIMULATION_CACHE_TTL_SECONDS` | `30` | Redis TTL per entry (1–600 seconds) |

## TTL tradeoffs

- **Too long**: Fee estimates may drift after network congestion changes.
- **Too short**: Less RPC savings on legitimate retries.

30 seconds matches the quote simulation cache default and covers typical
wallet-retry windows without serving long-lived stale fee data.
