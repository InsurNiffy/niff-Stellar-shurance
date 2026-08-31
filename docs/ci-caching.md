# CI Dependency Caching

## What is cached

| Workflow | Cache | Key | Path(s) |
|---|---|---|---|
| `contracts-ci.yml` | Cargo registry, git deps, build artifacts | `Cargo.lock` hash | `~/.cargo/registry`, `~/.cargo/git`, `target/` |
| `backend-ci.yml` | npm global cache (via `setup-node`) + `node_modules` | `backend/package-lock.json` hash | npm cache dir, `backend/node_modules` |
| `frontend-ci.yml` | npm global cache (via `setup-node`) + `node_modules` | `frontend/package-lock.json` hash | npm cache dir, `frontend/node_modules` |

Each cache key is derived from a hash of the relevant lockfile
(`Cargo.lock` or the workspace's `package-lock.json`). The `node_modules`
cache added on top of `setup-node`'s npm cache lets a fully-hit run skip
`npm ci` entirely rather than re-linking packages from the npm cache
every run.

## Cache invalidation

- Any change to `Cargo.lock` changes the Cargo cache key, so contract
  builds fall back to `restore-keys` (partial hit on registry/git, full
  rebuild of `target/`) or a cold cache on the first run after the bump.
- Any change to a `package-lock.json` changes the corresponding
  `node_modules` cache key. `npm ci` still runs whenever the cache isn't
  an exact hit, and `npm ci` always removes `node_modules` before
  installing, so a stale partial-match restore can never leak old
  packages into the install — it is always overwritten cleanly.

## Before / after (approximate, ubuntu-latest runners)

| Job | Cold (no cache) | Warm (lockfile unchanged) |
|---|---|---|
| Contracts (`cargo test` + wasm build) | ~6-7 min | ~2-3 min |
| Backend (`npm ci` + build + test) | ~90-120s | ~20-30s |
| Frontend (`npm ci` + build) | ~2-3 min | ~40-60s |

These are order-of-magnitude figures from typical GitHub-hosted runner
performance for repos of this size; actual numbers vary run to run and
should be re-measured from the Actions run summary timings if used for
capacity planning.
