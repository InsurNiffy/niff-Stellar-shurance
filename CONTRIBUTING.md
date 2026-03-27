# Contributing

## Soroban ABI golden vectors

The file `backend/src/soroban/golden-vectors.json` records the exact ScVal
type and argument order for every critical contract invocation.  CI fails if
the builders produce output that no longer matches these vectors.

### When to refresh

Refresh the vectors whenever you change:

- Any function signature in `contracts/niffyinsure/src/lib.rs`
- Argument builders in `backend/src/soroban/soroban.client.ts` or `backend/src/tx/tx.service.ts`
- Enum variants in `contracts/niffyinsure/src/types.rs`

### How to refresh

```bash
cd backend
npm run refresh-vectors
```

Review the diff carefully:

```bash
git diff backend/src/soroban/golden-vectors.json
```

- If the contract ABI changed (argument order, types, new/removed args), bump
  `_meta.contractSemver` in the JSON to match the new contract semver tag.
- If only the builder logic changed without an ABI change, leave `contractSemver`
  as-is and explain in the PR description.

Commit the updated file and open a PR.  A second engineer must review and
approve any vector changes before merge.

### Release checklist item

Before tagging a release:

- [ ] Run `npm run refresh-vectors` and confirm the diff is empty (or intentional).
- [ ] Confirm `_meta.contractSemver` matches the contract's `Cargo.toml` version.
- [ ] Update `contracts/deployment-registry.json` with the new wasm hash.

### Security rules

- **Never** commit real private keys (Stellar secret keys start with `S`).
- Use only placeholder G-addresses and C-addresses in vector `inputs`.
- The CI job checks for secret-key patterns and will fail if any are found.
