#!/usr/bin/env bash
# Validates that every #[contractevent] struct in the contracts is documented
# in EVENT_DICTIONARY.md. Fails CI with a diff listing undocumented events.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DICTIONARY="${ROOT_DIR}/EVENT_DICTIONARY.md"
EVENTS_FILE="${ROOT_DIR}/contracts/niffyinsure/src/events.rs"

if [[ ! -f "${DICTIONARY}" ]]; then
  echo "error: EVENT_DICTIONARY.md not found at ${DICTIONARY}" >&2
  exit 1
fi

if [[ ! -f "${EVENTS_FILE}" ]]; then
  echo "error: events.rs not found at ${EVENTS_FILE}" >&2
  exit 1
fi

# Extract every struct annotated with #[contractevent] from events.rs.
# Handles optional attributes between the annotation and the struct keyword.
documented_events() {
  # Collect event names mentioned in the dictionary. Event names are matched as
  # whole words so partial matches do not mask missing entries.
  grep -oE '\b[A-Z][A-Za-z0-9]*Event\b' "${DICTIONARY}" | sort -u
}

contract_events() {
  awk '
    /#\[contractevent/ { pending = 1; next }
    pending && /^[[:space:]]*#\[/ { next }
    pending && /struct[[:space:]]+[A-Za-z0-9_]+/ {
      match($0, /struct[[:space:]]+[A-Za-z0-9_]+/)
      name = substr($0, RSTART + 7, RLENGTH - 7)
      gsub(/[[:space:]]/, "", name)
      print name
      pending = 0
      next
    }
    pending && /^[[:space:]]*$/ { next }
    { pending = 0 }
  ' "${EVENTS_FILE}" | sort -u
}

DOCUMENTED="$(documented_events)"
CONTRACT="$(contract_events)"

if [[ -z "${CONTRACT}" ]]; then
  echo "error: no #[contractevent] structs found in ${EVENTS_FILE}" >&2
  exit 1
fi

MISSING="$(comm -23 <(printf '%s\n' "${CONTRACT}") <(printf '%s\n' "${DOCUMENTED}"))"

if [[ -n "${MISSING}" ]]; then
  echo "error: the following contract events are not documented in EVENT_DICTIONARY.md:" >&2
  echo "" >&2
  while IFS= read -r event; do
    [[ -z "${event}" ]] && continue
    echo "  - ${event}" >&2
  done <<< "${MISSING}"
  echo "" >&2
  echo "diff (contract events vs documented events):" >&2
  diff <(printf '%s\n' "${CONTRACT}") <(printf '%s\n' "${DOCUMENTED}") >&2 || true
  exit 1
fi

echo "ok: all $(printf '%s\n' "${CONTRACT}" | wc -l | tr -d ' ') contract events are documented in EVENT_DICTIONARY.md"
