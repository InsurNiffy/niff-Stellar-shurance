WASM_RAW   := target/wasm32-unknown-unknown/release/niffyinsure.wasm
WASM_OPT   := target/wasm32-unknown-unknown/release/niffyinsure.optimized.wasm
VERSION    := $(shell cargo metadata --no-deps --format-version 1 | python -c "import sys,json;pkgs=json.load(sys.stdin)['packages'];print(next(p['version'] for p in pkgs if p['name']=='niffyinsure'))")
GIT_TAG    := $(shell git describe --tags --exact-match 2>/dev/null || echo "dev")
ARTIFACT   := artifacts/niffyinsure-$(VERSION)-$(GIT_TAG).wasm

.PHONY: build test fmt lint sha clean wasm-release wasm-opt-check check-env audit install-hooks

build:
	cargo build --target wasm32-unknown-unknown --release

test:
	cargo test

fmt:
	cargo fmt --all -- --check

lint:
	cargo clippy --target wasm32-unknown-unknown --release -- -D warnings

audit:
	cargo audit --deny warnings \
		--ignore RUSTSEC-2024-0388 \
		--ignore RUSTSEC-2024-0436 \
		--ignore RUSTSEC-2026-0097

sha: build
	sha256sum $(WASM_RAW)

# ── Release pipeline ─────────────────────────────────────────────────────────
# Produces a deployable wasm, prints its SHA-256, and copies it to artifacts/.
# Usage: make wasm-release
# Output: artifacts/niffyinsure-<version>-<git-tag>.wasm + .sha256 sidecar
wasm-release: build
	@mkdir -p artifacts
	@if command -v wasm-opt >/dev/null 2>&1; then \
		echo "[wasm-opt] optimising with -Oz ..."; \
		wasm-opt -Oz --strip-debug $(WASM_RAW) -o $(WASM_OPT); \
		cp $(WASM_OPT) $(ARTIFACT); \
		echo "[wasm-opt] raw size:  $$(wc -c < $(WASM_RAW)) bytes"; \
		echo "[wasm-opt] opt size:  $$(wc -c < $(WASM_OPT)) bytes"; \
	else \
		echo "[wasm-opt] not found — skipping optimisation (install binaryen)"; \
		cp $(WASM_RAW) $(ARTIFACT); \
	fi
	@sha256sum $(ARTIFACT) | tee $(ARTIFACT).sha256
	@echo "Artifact: $(ARTIFACT)"

# Measure wasm-opt impact without overwriting the release artifact.
wasm-opt-check: build
	@command -v wasm-opt >/dev/null 2>&1 || (echo "wasm-opt not found"; exit 1)
	@wasm-opt -Oz --strip-debug $(WASM_RAW) -o /tmp/niffyinsure_check.wasm
	@echo "raw:  $$(wc -c < $(WASM_RAW)) bytes"
	@echo "opt:  $$(wc -c < /tmp/niffyinsure_check.wasm) bytes"

install-hooks:
	git config core.hooksPath .githooks
	@echo "Git hooks installed from .githooks/"

clean:
	cargo clean
	rm -rf artifacts

# ── OpenAPI client codegen ────────────────────────────────────────────────────
# Exports the backend OpenAPI spec to backend/openapi.json, then generates
# TypeScript types into frontend/src/lib/api/generated/openapi.d.ts.
# Usage: make generate-client
generate-client:
	cd backend && npm run export-spec
	cd frontend && npm run generate-client

# ── Local dev env check ───────────────────────────────────────────────────────
# Validates backend/.env and frontend/.env.local contain all required vars.
# Usage: make check-env
check-env:
	npx ts-node scripts/check-env-local.ts

# ── Env variable doc generator ────────────────────────────────────────────────
# Generates backend/.env.example and backend/docs/environment-variables.md
# from backend/src/config/env.definitions.ts.
# Usage: make generate-env-docs
generate-env-docs:
	cd backend && npm run env:example:generate
