#!/usr/bin/env bash
# scripts/wasm-release.sh
# Reproducible Wasm release build: compile → (optionally) wasm-opt → SHA-256.
# Usage: bash scripts/wasm-release.sh [--skip-opt] [--network <testnet|mainnet|futurenet>] [--verify] [--notify]
# Outputs: artifacts/niffyinsure-<version>-<git-tag>.wasm  +  .sha256 sidecar
set -euo pipefail

SKIP_OPT=false
NETWORK=""
RUN_VERIFY=false
SEND_NOTIFY=false

for arg in "$@"; do
  case "$arg" in
    --skip-opt)   SKIP_OPT=true ;;
    --verify)     RUN_VERIFY=true ;;
    --notify)     SEND_NOTIFY=true ;;
    --network)    shift; NETWORK="$1" ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION=$(cargo metadata --no-deps --format-version 1 \
  | python3 -c "import sys,json; pkgs=json.load(sys.stdin)['packages']; \
    print(next(p['version'] for p in pkgs if p['name']=='niffyinsure'))")
GIT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "dev")

RAW="target/wasm32-unknown-unknown/release/niffyinsure.wasm"
OPT="target/wasm32-unknown-unknown/release/niffyinsure.optimized.wasm"
ARTIFACT="artifacts/niffyinsure-${VERSION}-${GIT_TAG}.wasm"

echo "==> Building niffyinsure v${VERSION} (tag: ${GIT_TAG})"
cargo build --target wasm32-unknown-unknown --release

mkdir -p artifacts

if [[ "$SKIP_OPT" == "false" ]] && command -v wasm-opt &>/dev/null; then
  echo "==> wasm-opt -Oz (binaryen $(wasm-opt --version 2>&1 | head -1))"
  RAW_SIZE=$(wc -c < "$RAW")
  wasm-opt -Oz --strip-debug "$RAW" -o "$OPT"
  OPT_SIZE=$(wc -c < "$OPT")
  SAVING=$(( RAW_SIZE - OPT_SIZE ))
  echo "    raw: ${RAW_SIZE} bytes  →  opt: ${OPT_SIZE} bytes  (saved ${SAVING} bytes)"
  cp "$OPT" "$ARTIFACT"
else
  echo "==> wasm-opt skipped (not installed or --skip-opt passed)"
  cp "$RAW" "$ARTIFACT"
fi

sha256sum "$ARTIFACT" | tee "${ARTIFACT}.sha256"
WASM_HASH=$(awk '{print $1}' "${ARTIFACT}.sha256")
echo "==> Artifact: ${ARTIFACT}"
echo "==> SHA-256:  ${WASM_HASH}"

# ── Task 1: Reproducibility check ──────────────────────────────────────────
# Re-build into a second artifact and compare hashes to confirm reproducibility.
echo "==> Reproducibility check: rebuilding to verify identical output..."
ARTIFACT2="artifacts/niffyinsure-${VERSION}-${GIT_TAG}.verify.wasm"
cargo build --target wasm32-unknown-unknown --release 2>/dev/null
if [[ "$SKIP_OPT" == "false" ]] && command -v wasm-opt &>/dev/null; then
  wasm-opt -Oz --strip-debug "$RAW" -o "${OPT}.verify"
  cp "${OPT}.verify" "$ARTIFACT2"
  rm -f "${OPT}.verify"
else
  cp "$RAW" "$ARTIFACT2"
fi
HASH2=$(sha256sum "$ARTIFACT2" | awk '{print $1}')
rm -f "$ARTIFACT2"
if [[ "$WASM_HASH" == "$HASH2" ]]; then
  echo "==> ✅ Reproducibility confirmed: both builds produce identical hash (${WASM_HASH})"
else
  echo "==> ❌ Reproducibility FAILED: build1=${WASM_HASH}  build2=${HASH2}"
  exit 1
fi

# ── Task 2: Update deployment registry ─────────────────────────────────────
REGISTRY="contracts/deployment-registry.json"
DEPLOYED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

if [[ -f "$REGISTRY" ]] && command -v python3 &>/dev/null; then
  NETWORKS_TO_UPDATE="${NETWORK:-testnet mainnet futurenet}"
  echo "==> Updating deployment registry for: ${NETWORKS_TO_UPDATE}"
  python3 - <<PYEOF
import json, sys

registry_path = "${REGISTRY}"
wasm_hash     = "${WASM_HASH}"
version       = "${VERSION}"
deployed_at   = "${DEPLOYED_AT}"
networks      = "${NETWORKS_TO_UPDATE}".split()

with open(registry_path) as f:
    reg = json.load(f)

for net in networks:
    if net not in reg.get("networks", {}):
        continue
    for contract in reg["networks"][net].get("contracts", []):
        if contract.get("name") == "niffyinsure":
            contract["expectedWasmHash"]  = wasm_hash
            contract["expectedVersion"]   = version
            contract["deployedAt"]        = deployed_at

with open(registry_path, "w") as f:
    json.dump(reg, f, indent=2)
    f.write("\n")

print(f"  registry updated: hash={wasm_hash}  version={version}  deployedAt={deployed_at}")
PYEOF
else
  echo "==> WARNING: deployment registry not found or python3 unavailable — skipping registry update"
fi

# ── Task 3: Post-release version() verification ────────────────────────────
if [[ "$RUN_VERIFY" == "true" ]]; then
  if [[ -z "$NETWORK" ]]; then
    echo "==> WARNING: --verify requires --network <testnet|mainnet|futurenet> — skipping version check"
  else
    CONTRACT_ID_VAR="CONTRACT_ID_$(echo "$NETWORK" | tr '[:lower:]' '[:upper:]')"
    CONTRACT_ID="${!CONTRACT_ID_VAR:-}"
    if [[ -z "$CONTRACT_ID" ]]; then
      echo "==> WARNING: ${CONTRACT_ID_VAR} is not set — skipping version() check"
    elif ! command -v stellar &>/dev/null; then
      echo "==> WARNING: stellar CLI not found — skipping version() check"
    else
      echo "==> Post-release version() check on ${NETWORK} (contract: ${CONTRACT_ID})..."
      DEPLOYED_VERSION=$(stellar contract invoke \
        --id "$CONTRACT_ID" \
        --network "$NETWORK" \
        -- version 2>/dev/null | tr -d '"')
      if [[ "$DEPLOYED_VERSION" == "$VERSION" ]]; then
        echo "==> ✅ version() returned \"${DEPLOYED_VERSION}\" — matches expected v${VERSION}"
        # Write deployedVersion back to registry
        if [[ -f "$REGISTRY" ]] && command -v python3 &>/dev/null; then
          python3 - <<PYEOF2
import json
with open("${REGISTRY}") as f:
    reg = json.load(f)
net = "${NETWORK}"
if net in reg.get("networks", {}):
    for c in reg["networks"][net].get("contracts", []):
        if c.get("name") == "niffyinsure":
            c["deployedVersion"] = "${DEPLOYED_VERSION}"
with open("${REGISTRY}", "w") as f:
    json.dump(reg, f, indent=2)
    f.write("\n")
PYEOF2
        fi
      else
        echo "==> ❌ version() mismatch — expected \"${VERSION}\", got \"${DEPLOYED_VERSION}\""
        exit 1
      fi
    fi
  fi
fi

# ── Task 4: Release notification ───────────────────────────────────────────
if [[ "$SEND_NOTIFY" == "true" ]]; then
  SLACK_WEBHOOK="${SLACK_OPS_WEBHOOK:-}"
  if [[ -z "$SLACK_WEBHOOK" ]]; then
    echo "==> WARNING: SLACK_OPS_WEBHOOK not set — skipping release notification"
  else
    PAYLOAD=$(python3 -c "
import json
msg = {
  'text': ':rocket: *niffyinsure WASM release deployed*',
  'attachments': [{
    'color': 'good',
    'fields': [
      {'title': 'Version',   'value': '${VERSION}',      'short': True},
      {'title': 'Git Tag',   'value': '${GIT_TAG}',      'short': True},
      {'title': 'Network',   'value': '${NETWORK:-all}', 'short': True},
      {'title': 'SHA-256',   'value': '${WASM_HASH}',    'short': False},
      {'title': 'Deployed',  'value': '${DEPLOYED_AT}',  'short': True},
    ]
  }]
}
print(json.dumps(msg))
")
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST -H 'Content-type: application/json' \
      --data "$PAYLOAD" "$SLACK_WEBHOOK")
    if [[ "$HTTP_STATUS" == "200" ]]; then
      echo "==> ✅ Release notification sent to ops channel"
    else
      echo "==> WARNING: Slack notification returned HTTP ${HTTP_STATUS}"
    fi
  fi
fi

echo "==> Release complete: niffyinsure v${VERSION} (${GIT_TAG})"
