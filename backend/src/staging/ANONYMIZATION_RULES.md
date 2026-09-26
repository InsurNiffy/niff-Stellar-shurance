# Staging Data Sync: Anonymization Rules

**⚠️ COMPLIANCE NOTICE**: This document enumerates field-by-field anonymization rules for syncing production data into staging. **This list has NOT been reviewed by a compliance or privacy authority.** Before this job is run against real production data, a human with knowledge of data sensitivity classifications for this insurance product must review and confirm that:
1. No sensitive field was missed.
2. No field was misclassified.

Given this codebase likely contains health information, financial details, and other regulated data, the cost of a missed sensitive column is a real data breach. This sync job ships **disabled** and must not be automatically scheduled until that review is complete.

---

## Classification Categories

- **SAFE**: Field can be copied as-is into staging (e.g., status enums, counters, timestamps).
- **SYNTHETIC**: Field must be replaced with realistic synthetic/randomized data (e.g., names, emails, phone numbers, wallet addresses).
- **TOKENIZE**: Field must be replaced with a consistent anonymized token that preserves referential integrity within the synced dataset (e.g., foreign keys).
- **DROP**: Field must be removed or set to NULL (e.g., free-text fields containing unstructured PII or health details).
- **AUDIT_ONLY**: Field only used for audit/compliance and should not appear in staging data.

---

## Table-by-Table Rules

### `claims` (Claim records)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Internal claim ID; no identifying significance outside context |
| `policyId` | TOKENIZE | Foreign key reference; must remain consistent for claim-policy relationships |
| `creatorAddress` | SYNTHETIC | Wallet address of claim creator is PII and could identify individual |
| `amount` | SAFE | Coverage claim amount; not sensitive on its own |
| `asset` | SAFE | Asset type/code (e.g., "USDC"); status enum, not sensitive |
| `description` | DROP | Free-text claim description can contain health conditions, injury details, or other unstructured PII |
| `imageUrls` | DROP | Images could contain sensitive health/property information or face recognition data |
| `status` | SAFE | Enum (PENDING/APPROVED/PAID/REJECTED/UNDER_APPEAL) |
| `severity` | SAFE | Enum (LOW/MEDIUM/HIGH/CRITICAL) |
| `isFinalized` | SAFE | Boolean flag |
| `approveVotes` | SAFE | Vote count aggregate |
| `rejectVotes` | SAFE | Vote count aggregate |
| `paidAt` | SAFE | Timestamp when claim was paid |
| `createdAtLedger` | SAFE | Ledger sequence number |
| `updatedAtLedger` | SAFE | Ledger sequence number |
| `txHash` | DROP | Transaction hash could allow tracing real on-chain activity; not needed for staging |
| `eventIndex` | DROP | Event index similarly traces on-chain activity |
| `createdAt` | SAFE | Timestamp |
| `updatedAt` | SAFE | Timestamp |
| `tenantId` | SAFE | Logical tenant identifier or NULL in single-tenant |
| `deletedAt` | SAFE | Soft-delete timestamp |
| `appealsCount` | SAFE | Appeal count aggregate |
| `appealTxHash` | DROP | Transaction hash |

### `votes` (Voting records)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Auto-increment internal ID |
| `claimId` | TOKENIZE | Foreign key reference to claim |
| `voterAddress` | DROP | Wallet address of voter reveals voting behavior; should not appear in staging test data |
| `vote` | SAFE | Enum (APPROVE/REJECT) — voting choice without voter identity is harmless |
| `votingPower` | SAFE | Numeric voting power |
| `txHash` | DROP | Transaction hash |
| `eventIndex` | DROP | Event index |
| `votedAtLedger` | SAFE | Ledger sequence |
| `createdAt` | SAFE | Timestamp |
| `deletedAt` | SAFE | Soft-delete timestamp |

### `policies` (Insurance policies)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | TOKENIZE | Composite ID (holderAddress:policyId); must remain consistent within sync |
| `policyId` | SAFE | Numeric policy ID; safe once holderAddress is anonymized |
| `holderAddress` | SYNTHETIC | Wallet address of policy holder is PII |
| `policyType` | SAFE | Product type (e.g., "health", "property") |
| `region` | SAFE | Geographic region; generic location data without address is acceptable for staging |
| `coverageAmount` | SAFE | Coverage limit amount |
| `premium` | SAFE | Premium paid |
| `isActive` | SAFE | Boolean status |
| `startLedger` | SAFE | Ledger sequence |
| `endLedger` | SAFE | Ledger sequence |
| `assetContractId` | SAFE | SEP-41 contract address; technical identifier, not sensitive |
| `txHash` | DROP | Transaction hash |
| `eventIndex` | DROP | Event index |
| `createdAt` | SAFE | Timestamp |
| `updatedAt` | SAFE | Timestamp |
| `tenantId` | SAFE | Tenant identifier |
| `deletedAt` | SAFE | Soft-delete timestamp |

### `holder_profiles` (User profiles)
| Field | Classification | Rationale |
|-------|---|---|
| `wallet_address` | SYNTHETIC | Wallet address is PII |
| `display_name` | SYNTHETIC | User-entered display name could be personal name or real identity marker |
| `email` | SYNTHETIC | Personal email is PII |
| `locale` | SAFE | Language/locale preference |
| `notification_preferences` | SAFE | JSON boolean flags indicating notification opt-in state |
| `created_at` | SAFE | Timestamp |
| `updated_at` | SAFE | Timestamp |
| `last_seen_at` | SAFE | Last activity timestamp |

### `support_tickets` (Support requests)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Internal UUID |
| `email` | SYNTHETIC | Contact email is PII |
| `subject` | DROP | Support ticket subject could reveal sensitive personal/health details |
| `message` | DROP | Support message is free-text containing sensitive details |
| `ip_hash` | DROP | Even SHA-hashed IP can be sensitive; omit entirely |
| `status` | SAFE | Enum (OPEN/IN_PROGRESS/RESOLVED/CLOSED) |
| `assigned_to` | DROP | Staff member name/email; not needed for staging |
| `first_responded_at` | SAFE | Timestamp when first staff reply was sent |
| `created_at` | SAFE | Timestamp |
| `updated_at` | SAFE | Timestamp |

### `support_ticket_replies` (Support ticket comments)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Internal UUID |
| `ticket_id` | TOKENIZE | Foreign key; must remain consistent for reply-ticket relationships |
| `message` | DROP | Reply content could contain sensitive support details |
| `author` | SAFE | Enum ("customer" or "staff"); the role is harmless without identity info |
| `created_at` | SAFE | Timestamp |

### `notification_preferences` (User notification settings)
| Field | Classification | Rationale |
|-------|---|---|
| `user_id` | SYNTHETIC | Wallet address is PII |
| `renewal_reminders_enabled` | SAFE | Boolean preference |
| `claim_updates_enabled` | SAFE | Boolean preference |
| `created_at` | SAFE | Timestamp |
| `updated_at` | SAFE | Timestamp |

### `ramp_transactions` (Onramp financial transactions)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Internal UUID |
| `purchase_id` | SYNTHETIC | Ramp provider's purchase ID could be traced to real transaction |
| `status` | SAFE | Enum (COMPLETE/FAILED/REFUNDED) |
| `receiver_address` | SYNTHETIC | Wallet address of fund receiver is PII |
| `crypto_amount` | SAFE | Amount received |
| `crypto_currency` | SAFE | Currency type (e.g., "USDC") |
| `fiat_value` | SAFE | Fiat equivalent value |
| `fiat_currency` | SAFE | Currency code (e.g., "USD") |
| `final_tx_hash` | DROP | On-chain transaction hash traces to real activity |
| `last_synced_at` | SAFE | Timestamp |
| `created_at` | SAFE | Timestamp |
| `updated_at` | SAFE | Timestamp |

### `claim_comments` (Comments on claims)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Internal CUID |
| `claim_id` | TOKENIZE | Foreign key reference to claim |
| `author_address` | SYNTHETIC | Wallet address of comment author is PII |
| `body` | DROP | Comment text could contain sensitive discussion or unstructured PII |
| `created_at` | SAFE | Timestamp |
| `deleted_at` | SAFE | Soft-delete timestamp |

### `evidence_metadata` (Claim evidence records)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Internal auto-increment ID |
| `claim_id` | TOKENIZE | Foreign key reference to claim |
| `cid` | DROP | IPFS content identifier — evidence should not be copied to staging |
| `url` | DROP | Evidence URL |
| `file_size_bytes` | DROP | Evidence file metadata |
| `mime_type` | DROP | Evidence file metadata |
| `created_at` | SAFE | Timestamp |

### `registered_voters` (On-chain voter registry)
| Field | Classification | Rationale |
|-------|---|---|
| `wallet_address` | SYNTHETIC | Wallet address of registered voter is PII |
| `display_name` | SYNTHETIC | Voter display name could be real name |
| `registered_by` | SYNTHETIC | Admin wallet address who registered them is PII |
| `registered_at` | SAFE | Timestamp |

### `posts` (User-generated posts)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Auto-increment ID |
| `title` | DROP | Post title could identify author through content analysis |
| `body` | DROP | Post body could identify author and contains user-generated content not needed for staging |
| `status` | SAFE | Enum (DRAFT/PUBLISHED/ARCHIVED) |
| `author_address` | SYNTHETIC | Wallet address of post author is PII |
| `publish_at` | SAFE | Scheduled publish timestamp |
| `created_at` | SAFE | Timestamp |
| `updated_at` | SAFE | Timestamp |
| `deleted_at` | SAFE | Soft-delete timestamp |

### `ramp_transactions` (Onramp health status)
| Field | Classification | Rationale |
|-------|---|---|
| `id` | SAFE | Internal UUID |
| `status` | SAFE | Enum (up/degraded/down) |
| `last_checked_at` | SAFE | Timestamp |
| `error_message` | SAFE | Status error message (technical, not sensitive) |
| `created_at` | SAFE | Timestamp |
| `updated_at` | SAFE | Timestamp |

### Infrastructure / Non-user-data tables (SAFE to copy as-is)
- `indexer_state`: Indexing progress tracking
- `ledger_cursors`: Per-network ledger processing state
- `ledger_gap_alert_dedup`: Alert deduplication state
- `admin_audit_logs`: Immutable audit trail of admin actions — **AUDIT_ONLY**, do not include in staging
- `tenant_config_audit_logs`: Immutable tenant config audit trail — **AUDIT_ONLY**, do not include
- `feature_flags`: Feature flag state — **SAFE** to copy
- `wasm_drift_alerts`: WASM contract drift detection — **SAFE**
- `allowed_assets`: Allowlisted SEP-41 assets — **SAFE**
- `faq_items`: FAQ content — **SAFE**
- `faq_stats`: FAQ view counters — **SAFE**
- `tenants`: Tenant configuration — **SAFE**
- `notifications`: User notifications — mostly **SAFE** except `user_id` needs to be **SYNTHETIC**
- `privacy_requests`: Privacy request records — **AUDIT_ONLY**, do not include in staging
- `profile_audit_logs`: Field-level profile change audit — **AUDIT_ONLY**, do not include
- `raw_events`: Raw blockchain events — **SAFE** but subset only (recent events for testing)

---

## Synthetic Data Strategy

For fields classified as **SYNTHETIC**:
- **Wallet addresses** (`creatorAddress`, `holderAddress`, `voterAddress`, etc.): Replace with plausible Stellar strkey format (e.g., `G...` for public key, consistent within the same real wallet).
- **Email addresses** (`email`, `assignedTo`): Replace with deterministic fake addresses (e.g., `user_<hash>@staging.example.com`).
- **Display names**: Replace with generic names derived from hash (e.g., `User_<hash[:6]>`).
- **Purchase IDs**: Generate synthetic IDs matching the original format.

All synthetic replacements must be **deterministic** (same input always produces same output) so the dataset remains internally consistent across syncs.

---

## Tokenization Strategy

For fields classified as **TOKENIZE**:
- Use a consistent hash of the real value (e.g., SHA-256 of `policyId` or `claimId`).
- Truncate to a reasonable length to fit schema constraints.
- Ensure tokens remain valid for foreign-key relationships within the synced dataset.

---

## Tables NOT to Sync

The following tables should be completely omitted from staging syncs:
- `admin_audit_logs`: Immutable admin action audit trail — sensitive operational history
- `tenant_config_audit_logs`: Immutable tenant config change audit trail — operational history
- `privacy_requests`: Records of privacy-request submissions — sensitive compliance records
- `profile_audit_logs`: Field-level profile change audit — sensitive change history

These tables are not needed for functional staging testing and leak information about admin operations and compliance activities.

---

## Compliance Review Checklist

Before enabling this job to run against production, confirm:

- [ ] Does this list include every table that will exist in production?
- [ ] Does this list include every column in each table?
- [ ] Are wallet addresses (which are long-term persistent identifiers) properly anonymized?
- [ ] Are all free-text fields (`description`, `message`, `body`, etc.) dropped or marked for review?
- [ ] Are transaction hashes and on-chain event indices properly excluded?
- [ ] Are email addresses and personal names properly anonymized?
- [ ] Are audit/compliance tables properly excluded?
- [ ] Does the anonymization strategy preserve referential integrity for the tables that DO sync?
- [ ] Has this list been reviewed by someone with authority over this data's sensitivity classification?

If any of these cannot be confirmed, do not enable the job.
