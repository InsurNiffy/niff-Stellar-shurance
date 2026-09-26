#!/usr/bin/env bash
# Install git hooks into .git/hooks/
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$REPO_ROOT/scripts/hooks"
HOOKS_DIR="$REPO_ROOT/.git/hooks"

install_hook() {
  local name="$1"
  cp "$HOOKS_SRC/$name" "$HOOKS_DIR/$name"
  chmod +x "$HOOKS_DIR/$name"
  echo "Installed $name hook"
}

install_hook pre-commit

echo "All hooks installed. Run 'gitleaks version' to verify gitleaks is on PATH."
