#!/usr/bin/env bash
# Deploy niffyinsure contract to Stellar testnet.
#
# Usage:
#   ./scripts/deploy-contract.sh [network]
#
# Positional argument:
#   network   "testnet" (default) or "mainnet"
#
# Identity resolution order (first wins):
#   1. STELLAR_SECRET_KEY env var (base64 raw seed or Stellar-format seed)
#   2. STELLAR_IDENTITY env var   → name of a key in the Stellar CLI keystore
#   3. "deployer"                 → default keystore identity
#
# On success writes to contracts/deployment-registry.json:
#   contract_id, wasm_hash, deployed_at_ledger, network, timestamp
#
# Never writes secrets to disk. CI should pass STELLAR_SECRET_KEY
# via a masked environment variable.

set -euo pipefail

NETWORK="${1:-testnet}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY="${REPO_ROOT}/contracts/deployment-registry.json"
WASM_OUT="${REPO_ROOT}/target/wasm32v1-none/release/niffyinsure.wasm"

case "${NETWORK}" in
  testnet)
    RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
    NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
    ;;
  mainnet)
    RPC_URL="${SOROBAN_RPC_URL:?SOROBAN_RPC_URL must be set for mainnet}"
    NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:?STELLAR_NETWORK_PASSPHRASE must be set for mainnet}"
    ;;
  *)
    echo "Unknown network: ${NETWORK}" >&2
    exit 1
    ;;
esac

# ── Resolve identity ───────────────────────────────────────────────────────────
IDENTITY_FLAGS=()
if [[ -n "${STELLAR_SECRET_KEY:-}" ]]; then
  # Accept raw seed via env var without touching the keystore.
  IDENTITY_FLAGS+=(--source-account "${STELLAR_SECRET_KEY}")
elif [[ -n "${STELLAR_IDENTITY:-}" ]]; then
  IDENTITY_FLAGS+=(--source-account "${STELLAR_IDENTITY}")
else
  IDENTITY_FLAGS+=(--source-account deployer)
fi

# ── Build ──────────────────────────────────────────────────────────────────────
echo "==> Building WASM (release)…"
cargo build --release --target wasm32v1-none \
  -p niffyinsure \
  --manifest-path "${REPO_ROOT}/Cargo.toml"

if [[ ! -f "${WASM_OUT}" ]]; then
  echo "WASM output not found at ${WASM_OUT}" >&2
  exit 1
fi

WASM_SIZE=$(wc -c <"${WASM_OUT}")
echo "    WASM size: ${WASM_SIZE} bytes"

COMMON=(
  --rpc-url "${RPC_URL}"
  --network-passphrase "${NETWORK_PASSPHRASE}"
  "${IDENTITY_FLAGS[@]}"
)

# ── Upload ─────────────────────────────────────────────────────────────────────
echo "==> Uploading WASM…"
WASM_HASH=$(stellar contract upload \
  "${COMMON[@]}" \
  --wasm "${WASM_OUT}")
echo "    WASM hash: ${WASM_HASH}"

# ── Deploy ─────────────────────────────────────────────────────────────────────
echo "==> Deploying contract…"
CONTRACT_ID=$(stellar contract deploy \
  "${COMMON[@]}" \
  --wasm-hash "${WASM_HASH}")
echo "    Contract ID: ${CONTRACT_ID}"

# ── Deployed-at ledger ─────────────────────────────────────────────────────────
DEPLOYED_LEDGER=$(stellar ledger \
  --rpc-url "${RPC_URL}" \
  --network-passphrase "${NETWORK_PASSPHRASE}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['sequence'])" 2>/dev/null || echo "unknown")

# ── Write registry ─────────────────────────────────────────────────────────────
python3 - <<PYEOF
import json, datetime, pathlib

registry = pathlib.Path("${REGISTRY}")
try:
    data = json.loads(registry.read_text())
except (FileNotFoundError, json.JSONDecodeError):
    data = {}

data.update({
    "contract_id": "${CONTRACT_ID}",
    "wasm_hash": "${WASM_HASH}",
    "deployed_at_ledger": "${DEPLOYED_LEDGER}",
    "network": "${NETWORK}",
    "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    "wasm_size_bytes": ${WASM_SIZE},
})
registry.write_text(json.dumps(data, indent=2) + "\n")
print("Registry updated:", registry)
PYEOF

echo "==> Done. Contract ${CONTRACT_ID} deployed on ${NETWORK}."
