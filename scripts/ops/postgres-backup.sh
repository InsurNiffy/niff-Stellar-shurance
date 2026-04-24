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

require_env "DATABASE_URL"
require_env "BACKUP_BUCKET"
require_env "BACKUP_PREFIX"
require_env "BACKUP_KMS_KEY_ID"

require_cmd "aws"
require_cmd "jq"
require_cmd "pg_dump"
require_cmd "sha256sum"

backup_environment="${BACKUP_ENVIRONMENT:-production}"
retention_days="${BACKUP_RETENTION_DAYS:-35}"
skip_prune="${BACKUP_SKIP_PRUNE:-0}"
output_dir="${BACKUP_OUTPUT_DIR:-backup-artifacts}"
repo_name="${GITHUB_REPOSITORY:-local}"
prefix="${BACKUP_PREFIX#/}"
prefix="${prefix%/}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

mkdir -p "$output_dir"

timestamp_compact="$(date -u +%Y%m%dT%H%M%SZ)"
timestamp_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
object_base="${prefix}/${backup_environment}/postgres-${timestamp_compact}"
dump_file="${tmpdir}/postgres.dump"
metadata_file="${tmpdir}/postgres.metadata.json"
inventory_file="${tmpdir}/inventory.json"

echo "Creating PostgreSQL backup for ${backup_environment} at ${timestamp_iso}"
pg_dump \
  --dbname="${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="${dump_file}"

dump_sha256="$(sha256sum "${dump_file}" | awk '{print $1}')"
dump_size_bytes="$(stat -c %s "${dump_file}")"
dump_key="${object_base}.dump"
metadata_key="${object_base}.metadata.json"

echo "Uploading encrypted dump to s3://${BACKUP_BUCKET}/${dump_key}"
aws s3 cp "${dump_file}" "s3://${BACKUP_BUCKET}/${dump_key}" \
  --sse aws:kms \
  --sse-kms-key-id "${BACKUP_KMS_KEY_ID}" \
  --metadata "sha256=${dump_sha256},created_at=${timestamp_iso},environment=${backup_environment},repository=${repo_name}"

jq -n \
  --arg bucket "${BACKUP_BUCKET}" \
  --arg environment "${backup_environment}" \
  --arg dumpKey "${dump_key}" \
  --arg metadataKey "${metadata_key}" \
  --arg createdAt "${timestamp_iso}" \
  --arg repository "${repo_name}" \
  --arg sha256 "${dump_sha256}" \
  --arg kmsKeyId "${BACKUP_KMS_KEY_ID}" \
  --argjson retentionDays "${retention_days}" \
  --argjson sizeBytes "${dump_size_bytes}" \
  '{
    backupBucket: $bucket,
    backupEnvironment: $environment,
    dumpObjectKey: $dumpKey,
    metadataObjectKey: $metadataKey,
    createdAt: $createdAt,
    repository: $repository,
    sha256: $sha256,
    kmsKeyId: $kmsKeyId,
    retentionDays: $retentionDays,
    sizeBytes: $sizeBytes
  }' > "${metadata_file}"

aws s3 cp "${metadata_file}" "s3://${BACKUP_BUCKET}/${metadata_key}" \
  --sse aws:kms \
  --sse-kms-key-id "${BACKUP_KMS_KEY_ID}"

deleted_count=0
if [[ "${skip_prune}" != "1" ]]; then
  cutoff_epoch="$(date -u -d "-${retention_days} days" +%s)"
  aws s3api list-objects-v2 \
    --bucket "${BACKUP_BUCKET}" \
    --prefix "${prefix}/${backup_environment}/" \
    --output json > "${inventory_file}"

  mapfile -t expired_keys < <(
    jq -r \
      --argjson cutoff "${cutoff_epoch}" \
      '
        .Contents[]?
        | select(.Key | endswith(".dump") or endswith(".metadata.json"))
        | select((.LastModified | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) < $cutoff)
        | .Key
      ' "${inventory_file}"
  )

  for key in "${expired_keys[@]}"; do
    [[ -z "${key}" ]] && continue
    aws s3 rm "s3://${BACKUP_BUCKET}/${key}"
    deleted_count=$((deleted_count + 1))
  done
fi

cp "${metadata_file}" "${output_dir}/$(basename "${metadata_file}")"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Postgres backup"
    echo
    echo "- Environment: \`${backup_environment}\`"
    echo "- Dump object: \`s3://${BACKUP_BUCKET}/${dump_key}\`"
    echo "- Metadata object: \`s3://${BACKUP_BUCKET}/${metadata_key}\`"
    echo "- SHA-256: \`${dump_sha256}\`"
    echo "- Size (bytes): \`${dump_size_bytes}\`"
    echo "- Retention days: \`${retention_days}\`"
    echo "- Pruned objects this run: \`${deleted_count}\`"
  } >> "${GITHUB_STEP_SUMMARY}"
fi

echo "Backup complete"
