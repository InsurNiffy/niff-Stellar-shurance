# Wasm Release Pipeline

## One-command release build

```bash
make wasm-release
# or
bash scripts/wasm-release.sh [--skip-opt] [--network <testnet|mainnet|futurenet>] [--verify] [--notify]
```

| Flag | Description |
|------|-------------|
| `--skip-opt` | Skip `wasm-opt` pass (use raw binary) |
| `--network` | Target network for registry update and version check |
| `--verify` | Call `version()` entrypoint after build to confirm deployed contract version |
| `--notify` | Send release notification to the ops Slack channel (`SLACK_OPS_WEBHOOK` env var required) |

Full release with verification and notification:
```bash
SLACK_OPS_WEBHOOK=https://hooks.slack.com/... \
CONTRACT_ID_TESTNET=C... \
bash scripts/wasm-release.sh --network testnet --verify --notify
```

Outputs:
- `artifacts/niffyinsure-<version>-<git-tag>.wasm` — deployable binary
- `artifacts/niffyinsure-<version>-<git-tag>.wasm.sha256` — SHA-256 sidecar

The SHA-256 is printed to stdout and written to the sidecar file. Ops must record this hash in the deployment registry and verify it on-chain after deploy (see [Verification](#on-chain-verification)).

---

## wasm-opt decision

| Metric | Raw (`-Oz` profile in Cargo.toml) | After `wasm-opt -Oz` |
|--------|-----------------------------------|----------------------|
| Typical size | ~120 KB | ~95 KB |
| Instruction count impact | baseline | ≤ 5 % reduction (measured) |
| Determinism | ✅ same toolchain → same bytes | ✅ same binaryen version → same bytes |

**Decision: wasm-opt is applied in CI release builds** using `wasm-opt -Oz --strip-debug`.  
The `--strip-debug` flag removes DWARF sections that are not needed on-chain and reduces size further.  
If `wasm-opt` is absent locally, `make wasm-release` falls back to the raw binary with a warning.

Binaryen version is pinned via the Ubuntu `binaryen` package in CI. Pin the exact version in the workflow if stricter reproducibility is required.

---

## Version stamping

The contract exposes a `version()` entrypoint that returns the semver string from `Cargo.toml` at compile time via `env!("CARGO_PKG_VERSION")`. No runtime storage is used.

```bash
stellar contract invoke --id <CONTRACT_ID> --network testnet -- version
# → "0.1.0"
```

The artifact filename also embeds the version and git tag, e.g. `niffyinsure-0.1.0-v0.1.0.wasm`.

---

## Reproducibility expectations

Wasm builds are **deterministic within a fixed toolchain** (same `rustc`, same `soroban-sdk`, same `binaryen`). Across toolchain versions they are **not guaranteed to be byte-identical**.

To maximise reproducibility:
- `Cargo.lock` is committed and must not be modified without review.
- The Rust toolchain version is pinned via `dtolnay/rust-toolchain@stable` in CI (update deliberately).
- `wasm-opt` version is pinned to the Ubuntu package in CI.
- `[profile.release]` in `Cargo.toml` is the single source of truth for compiler flags.

**Non-determinism sources to be aware of:**
- Different `rustc` versions produce different code even for identical source.
- `wasm-opt` versions differ across OS package managers.
- Build timestamps are stripped (`strip = "symbols"`, `debug = false`).

---

## CI artifact naming

Artifacts are named `niffyinsure-<version>-<git-tag>.wasm` and are:
- Uploaded to the GitHub Actions run (90-day retention) on every tag push.
- Attached to the GitHub Release as downloadable assets.

Artifact names are immutable once a tag is pushed. Never re-push a tag.

---

## On-chain verification

After deploying, verify the on-chain wasm hash matches the expected value:

```bash
# 1. Get the wasm hash from the artifact sidecar
EXPECTED=$(awk '{print $1}' artifacts/niffyinsure-<version>-<tag>.wasm.sha256)

# 2. Fetch the on-chain wasm hash via Stellar RPC
ONCHAIN=$(stellar contract info --id <CONTRACT_ID> --network mainnet \
  | jq -r '.wasm_hash')

# 3. Compare
if [ "$EXPECTED" = "$ONCHAIN" ]; then
  echo "✅ Hash match: $ONCHAIN"
else
  echo "❌ MISMATCH — expected $EXPECTED, got $ONCHAIN"
  exit 1
fi
```

Record the expected hash in `contracts/deployment-registry.json` under `expectedWasmHash` for each network.

---

## Supply-chain practices

- `Cargo.lock` is committed; dependency updates require explicit PR review.
- `cargo audit` should be run before each release (add to CI as needed).
- No `*` version ranges in `Cargo.toml`; all dependencies are pinned with `=`.

---

## Rollback procedure

Use this procedure when a bad WASM release is detected (hash mismatch, version() failure, or runtime regression).

### Step 1 — Identify the last known-good release

```bash
# List recent GitHub releases and their attached .sha256 files
gh release list --limit 10
gh release download <last-good-tag> --pattern "*.sha256" --dir /tmp/rollback
cat /tmp/rollback/*.sha256
```

### Step 2 — Download the last known-good artifact

```bash
gh release download <last-good-tag> --pattern "*.wasm" --dir /tmp/rollback
ARTIFACT=/tmp/rollback/niffyinsure-<version>-<last-good-tag>.wasm
```

### Step 3 — Verify the artifact hash before re-deploying

```bash
EXPECTED=$(awk '{print $1}' /tmp/rollback/*.sha256)
ACTUAL=$(sha256sum "$ARTIFACT" | awk '{print $1}')
[ "$EXPECTED" = "$ACTUAL" ] && echo "✅ Hash OK" || { echo "❌ Corrupt artifact"; exit 1; }
```

### Step 4 — Re-deploy the known-good WASM

```bash
stellar contract deploy \
  --wasm "$ARTIFACT" \
  --network <testnet|mainnet> \
  --source <deployer-key>
```

### Step 5 — Confirm rollback with version() check

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network <testnet|mainnet> \
  -- version
# Must return the version string of the known-good release
```

### Step 6 — Update the deployment registry

Edit `contracts/deployment-registry.json` and set:
- `expectedWasmHash` → hash of the rolled-back artifact
- `expectedVersion`  → version of the rolled-back artifact
- `deployedVersion`  → confirmed output of `version()`
- `deployedAt`       → timestamp of the rollback

Commit and push the registry update with a message like:
```
fix(registry): rollback niffyinsure to <last-good-tag> on <network>
```

### Step 7 — Notify the team

Post in the ops channel with:
- Which tag was rolled back to
- Which network was affected
- Root cause (if known)
- Link to the incident or GitHub issue

### Prevention checklist

- [ ] Never re-push a git tag — create a new patch tag instead
- [ ] Always run `--verify` after every deploy
- [ ] Keep the last 3 release artifacts in GitHub Releases (90-day retention in Actions)
- [ ] Treat any `version()` mismatch as a rollback trigger
