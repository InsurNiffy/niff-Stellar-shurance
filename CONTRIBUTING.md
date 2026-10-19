# Contributing

## Git hooks (secret scanning)

This repository ships a Git pre-commit hook that runs [gitleaks](https://github.com/gitleaks/gitleaks) against staged changes to prevent committing secrets. The rules live in `.gitleaks.toml`.

Install the hooks once after cloning:

```sh
make install-hooks
```

This sets `core.hooksPath` to `.githooks` so the `pre-commit` hook runs automatically on every commit. Make sure `gitleaks` is installed and available on your `PATH` (e.g. `brew install gitleaks` or download a release binary).

If a commit is blocked because a secret was detected, remove the secret from the staged changes (or rotate it if it was already pushed) and commit again. Do not bypass the hook with `--no-verify`.
