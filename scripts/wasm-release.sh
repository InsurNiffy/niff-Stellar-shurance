#!/usr/bin/env bash
# scripts/wasm-release.sh
# Reproducible Wasm release build: compile → (optionally) wasm-opt → SHA-256.
# Usage: bash scripts/wasm-release.sh [--skip-opt]
# Outputs: artifacts/niffyinsure-<version>-<git-tag>.wasm  +  .sha256 sidecar
set -euo pipefail

SKIP_OPT=false
for arg in "$@"; do [[ "$arg" == "--skip-opt" ]] && SKIP_OPT=true; done

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
echo "==> Artifact: ${ARTIFACT}"
