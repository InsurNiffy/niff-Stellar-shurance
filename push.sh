#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  push_issues.sh  –  Create GitHub issues from a Markdown file
#
#  Usage:
#    ./push_issues.sh <owner/repo> <issues.md> [--dry-run] [issue_numbers...]
#
#  Examples:
#    ./push_issues.sh Synapse-bridgez/synapse-contracts issues.md          # push ALL
#    ./push_issues.sh Synapse-bridgez/synapse-contracts issues.md 5 10 20  # push #5, #10, #20
#    ./push_issues.sh Synapse-bridgez/synapse-contracts issues.md --dry-run
#    ./push_issues.sh Synapse-bridgez/synapse-contracts issues.md --dry-run 1 2 3
#
#  Markdown format expected:
#    ## #1 Issue Title
#    Body text…
#
#    ## #2 Next Issue Title
#    Another body…
#
#  Features:
#    • Pushes all issues or only the specified issue numbers
#    • Fetches existing GitHub issues first to prevent duplicates
#    • --dry-run flag previews what would be pushed
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ── Load .env from the script's own directory ────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -o allexport
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +o allexport
else
  echo "Notice: No .env file found at ${ENV_FILE} — falling back to environment."
fi

# ── Validate inputs ──────────────────────────────────────────
if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <owner/repo> <issues.md> [--dry-run] [issue_numbers...]"
  echo ""
  echo "  --dry-run          List issues that would be pushed without creating them"
  echo "  issue_numbers      Optional list of issue numbers to push (e.g. 5 10 20)"
  echo "                     If omitted, all issues from the file are pushed."
  exit 1
fi

REPO="$1"
FILE="$2"
shift 2

API="https://api.github.com/repos/${REPO}/issues"
DRY_RUN=false
declare -A SELECTED_ISSUES=() # associative array of issue numbers to push
SELECTED_COUNT=0

# Parse remaining args: --dry-run and/or issue numbers
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=true
  elif [[ "$arg" =~ ^[0-9]+$ ]]; then
    SELECTED_ISSUES["$arg"]=1
    SELECTED_COUNT=$((SELECTED_COUNT + 1))
  else
    echo "Error: Unknown argument '$arg'. Expected --dry-run or an issue number."
    exit 1
  fi
done

PUSH_ALL=true
if [[ "$SELECTED_COUNT" -gt 0 ]]; then
  PUSH_ALL=false
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN is not set in .env or environment."
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "Error: File '$FILE' not found."
  exit 1
fi

if $DRY_RUN; then
  echo "🔍 DRY-RUN mode — no issues will be created."
fi

if $PUSH_ALL; then
  echo "📋 Pushing ALL issues from $FILE"
else
  echo "📋 Pushing issues: ${!SELECTED_ISSUES[*]}"
fi

# ── Fetch existing GitHub issues for duplicate detection ─────
echo ""
echo "⏳ Fetching existing issues from GitHub to check for duplicates..."

declare -A EXISTING_TITLES # title -> "exists"
page=1
while true; do
  response="$(curl -s \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${API}?state=all&per_page=100&page=${page}")"

  # Check for API errors
  if echo "$response" | jq -e '.message' &>/dev/null 2>&1; then
    msg="$(echo "$response" | jq -r '.message')"
    # "Not Found" is a string message, but a valid empty array [] also passes jq parsing
    if [[ "$msg" != "null" ]]; then
      echo "Error fetching existing issues: $msg"
      exit 1
    fi
  fi

  count="$(echo "$response" | jq 'length')"
  if [[ "$count" -eq 0 ]]; then
    break
  fi

  # Extract all titles from this page
  while IFS= read -r existing_title; do
    EXISTING_TITLES["$existing_title"]=1
  done < <(echo "$response" | jq -r '.[].title')

  if [[ "$count" -lt 100 ]]; then
    break
  fi
  page=$((page + 1))
done

echo "   Found ${#EXISTING_TITLES[@]} existing issue(s) on GitHub."
echo ""

# ── Parse markdown into issues ───────────────────────────────
declare -a ISSUE_NUMBERS=()
declare -A ISSUE_TITLES=()
declare -A ISSUE_BODIES=()

current_num=""
current_title=""
current_body=""

save_current() {
  if [[ -n "$current_num" && -n "$current_title" ]]; then
    ISSUE_NUMBERS+=("$current_num")
    # Trim leading/trailing whitespace from body
    local trimmed_body
    trimmed_body="$(echo "$current_body" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    ISSUE_TITLES["$current_num"]="$current_title"
    ISSUE_BODIES["$current_num"]="$trimmed_body"
  fi
}

while IFS= read -r line || [[ -n "$line" ]]; do
  # Match: ## #N Title text
  if [[ "$line" =~ ^##[[:space:]]+\#([0-9]+)[[:space:]]+(.+)$ ]]; then
    save_current
    current_num="${BASH_REMATCH[1]}"
    current_title="${BASH_REMATCH[2]}"
    current_body=""
  # Match: ## Title text (no #N prefix — legacy format)
  elif [[ "$line" =~ ^##[[:space:]]+(.+)$ ]]; then
    save_current
    current_num="auto_$((${#ISSUE_NUMBERS[@]} + 1))"
    current_title="${BASH_REMATCH[1]}"
    current_body=""
  elif [[ -n "$current_num" ]]; then
    if [[ -n "$current_body" || -n "$line" ]]; then
      current_body+="${line}"$'\n'
    fi
  fi
done <"$FILE"

# Save the last issue
save_current

echo "📄 Parsed ${#ISSUE_NUMBERS[@]} issue(s) from $FILE"
echo ""

# ── Push issues ──────────────────────────────────────────────
created=0
skipped_dup=0
skipped_filter=0
failed=0

for num in "${ISSUE_NUMBERS[@]}"; do
  title="${ISSUE_TITLES[$num]}"
  body="${ISSUE_BODIES[$num]}"

  # Skip if not in the selected list
  if ! $PUSH_ALL; then
    # Strip "auto_" prefix for matching if present
    match_num="${num#auto_}"
    if [[ -z "${SELECTED_ISSUES[$match_num]:-}" && -z "${SELECTED_ISSUES[$num]:-}" ]]; then
      skipped_filter=$((skipped_filter + 1))
      continue
    fi
  fi

  # Build the full title as it will appear on GitHub
  # For auto-numbered (numberless) issues, use the title as-is
  if [[ "$num" == auto_* ]]; then
    gh_title="${title}"
  else
    gh_title="#${num} ${title}"
  fi

  # Check for duplicates using the full GitHub title
  if [[ -n "${EXISTING_TITLES[$gh_title]:-}" ]]; then
    echo "⏭  Skipping #${num} (duplicate): \"${title}\""
    skipped_dup=$((skipped_dup + 1))
    continue
  fi

  # Also check by just the title text (in case it was pushed without #N prefix)
  if [[ -n "${EXISTING_TITLES[$title]:-}" ]]; then
    echo "⏭  Skipping #${num} (duplicate): \"${title}\""
    ((skipped_dup++))
    continue
  fi

  if $DRY_RUN; then
    echo "🟡 Would push #${num}: \"${title}\""
    created=$((created + 1))
    continue
  fi

  echo "→ Creating issue #${num}: \"${title}\""

  payload="$(jq -n --arg title "$gh_title" --arg body "$body" \
    '{title: $title, body: $body}')"

  http_code="$(curl -s -o /tmp/_issue_response.json -w "%{http_code}" \
    -X POST "$API" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "Content-Type: application/json" \
    --data "$payload")"

  if [[ "$http_code" == "201" ]]; then
    url="$(jq -r '.html_url' /tmp/_issue_response.json)"
    echo "  ✓ Created: $url"
    # Add to existing titles so if same title appears twice in file, it won't push again
    EXISTING_TITLES["$gh_title"]=1
    EXISTING_TITLES["$title"]=1
    created=$((created + 1))
  else
    msg="$(jq -r '.message // "Unknown error"' /tmp/_issue_response.json)"
    echo "  ✗ Failed (HTTP $http_code): $msg"
    failed=$((failed + 1))
  fi
done

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
if $DRY_RUN; then
  echo "  DRY-RUN SUMMARY"
  echo "  Would create:  $created"
else
  echo "  SUMMARY"
  echo "  Created:       $created"
fi
echo "  Skipped (dup): $skipped_dup"
if ! $PUSH_ALL; then
  echo "  Skipped (n/a): $skipped_filter"
fi
echo "  Failed:        $failed"
echo "═══════════════════════════════════════════════"
