#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "error: required environment variable '$name' is not set" >&2
    exit 1
  fi
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "error: required command '$name' is not available" >&2
    exit 1
  fi
}

require_env "BACKUP_BUCKET"
require_env "BACKUP_PREFIX"
require_env "RESTORE_DATABASE_URL"

require_cmd "aws"
require_cmd "jq"
require_cmd "pg_restore"
require_cmd "psql"
require_cmd "sha256sum"

restore_environment="${RESTORE_ENVIRONMENT:-production}"
output_dir="${DRILL_OUTPUT_DIR:-drill-evidence}"
prefix="${BACKUP_PREFIX#/}"
prefix="${prefix%/}"
requested_object_key="${BACKUP_OBJECT_KEY:-}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

mkdir -p "$output_dir"

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
inventory_file="${tmpdir}/inventory.json"
dump_file="${tmpdir}/restore.dump"
metadata_file="${tmpdir}/restore.metadata.json"
evidence_file="${output_dir}/restore-evidence.json"

if [[ -z "${requested_object_key}" ]]; then
  aws s3api list-objects-v2 \
    --bucket "${BACKUP_BUCKET}" \
    --prefix "${prefix}/${restore_environment}/" \
    --output json > "${inventory_file}"

  requested_object_key="$(
    jq -r '
      [ .Contents[]? | select(.Key | endswith(".dump")) ]
      | sort_by(.LastModified)
      | last
      | .Key // empty
    ' "${inventory_file}"
  )"
fi

if [[ -z "${requested_object_key}" ]]; then
  echo "error: no backup dump found under s3://${BACKUP_BUCKET}/${prefix}/${restore_environment}/" >&2
  exit 1
fi

metadata_key="${requested_object_key%.dump}.metadata.json"

echo "Downloading ${requested_object_key}"
aws s3 cp "s3://${BACKUP_BUCKET}/${requested_object_key}" "${dump_file}"

if aws s3 cp "s3://${BACKUP_BUCKET}/${metadata_key}" "${metadata_file}" >/dev/null 2>&1; then
  expected_sha="$(jq -r '.sha256 // empty' "${metadata_file}")"
  if [[ -n "${expected_sha}" ]]; then
    actual_sha="$(sha256sum "${dump_file}" | awk '{print $1}')"
    if [[ "${expected_sha}" != "${actual_sha}" ]]; then
      echo "error: checksum mismatch for ${requested_object_key}" >&2
      exit 1
    fi
  fi
fi

psql "${RESTORE_DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SQL

pg_restore \
  --dbname="${RESTORE_DATABASE_URL}" \
  --no-owner \
  --no-privileges \
  "${dump_file}"

required_tables=(
  "admin_audit_logs"
  "claims"
  "ledger_cursors"
  "policies"
  "raw_events"
  "votes"
)

for table_name in "${required_tables[@]}"; do
  exists="$(
    psql "${RESTORE_DATABASE_URL}" -Atqc \
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table_name}');"
  )"
  if [[ "${exists}" != "t" ]]; then
    echo "error: required table '${table_name}' is missing after restore" >&2
    exit 1
  fi
done

public_table_count="$(
  psql "${RESTORE_DATABASE_URL}" -Atqc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
)"
policy_count="$(psql "${RESTORE_DATABASE_URL}" -Atqc 'SELECT COUNT(*) FROM policies;')"
claim_count="$(psql "${RESTORE_DATABASE_URL}" -Atqc 'SELECT COUNT(*) FROM claims;')"
raw_event_count="$(psql "${RESTORE_DATABASE_URL}" -Atqc 'SELECT COUNT(*) FROM raw_events;')"
latest_raw_event_ledger="$(
  psql "${RESTORE_DATABASE_URL}" -Atqc \
    'SELECT COALESCE(MAX(ledger), 0) FROM raw_events;'
)"
latest_cursor_json="$(
  psql "${RESTORE_DATABASE_URL}" -Atqc \
    "SELECT COALESCE(json_agg(row_to_json(t))::text, '[]') FROM (SELECT network, last_processed_ledger FROM ledger_cursors ORDER BY network) t;"
)"

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -n \
  --arg startedAt "${started_at}" \
  --arg completedAt "${completed_at}" \
  --arg bucket "${BACKUP_BUCKET}" \
  --arg objectKey "${requested_object_key}" \
  --arg metadataKey "${metadata_key}" \
  --argjson publicTableCount "${public_table_count}" \
  --argjson policyCount "${policy_count}" \
  --argjson claimCount "${claim_count}" \
  --argjson rawEventCount "${raw_event_count}" \
  --argjson latestRawEventLedger "${latest_raw_event_ledger}" \
  --argjson ledgerCursors "${latest_cursor_json}" \
  '{
    startedAt: $startedAt,
    completedAt: $completedAt,
    backupBucket: $bucket,
    backupObjectKey: $objectKey,
    metadataObjectKey: $metadataKey,
    publicTableCount: $publicTableCount,
    policyCount: $policyCount,
    claimCount: $claimCount,
    rawEventCount: $rawEventCount,
    latestRawEventLedger: $latestRawEventLedger,
    ledgerCursors: $ledgerCursors
  }' > "${evidence_file}"

cp "${metadata_file}" "${output_dir}/$(basename "${metadata_file}")" 2>/dev/null || true

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Restore drill"
    echo
    echo "- Backup object: \`s3://${BACKUP_BUCKET}/${requested_object_key}\`"
    echo "- Restore started: \`${started_at}\`"
    echo "- Restore completed: \`${completed_at}\`"
    echo "- Public tables restored: \`${public_table_count}\`"
    echo "- Policies: \`${policy_count}\`"
    echo "- Claims: \`${claim_count}\`"
    echo "- Raw events: \`${raw_event_count}\`"
    echo "- Latest raw-event ledger: \`${latest_raw_event_ledger}\`"
  } >> "${GITHUB_STEP_SUMMARY}"
fi

echo "Restore validation complete"
