# Claim evidence: URL + SHA-256 commitment

Each filed claim stores **evidence** as a list of entries `{ url, hash }` where `hash` is a **32-byte SHA-256 digest** the submitter asserts matches the content at `url` at filing time.

## On-chain scope

The contract **does not**:

- Fetch `url` or read file bytes.
- Compute SHA-256 over content.
- Verify that `hash` matches the bytes at `url`.

It **only**:

- Enforces structural limits (URL length, max entries).
- Rejects the **all-zero** digest at `file_claim` (returns `ExcessiveEvidenceBytes` — the enum is at Soroban’s max variant count, so there is no separate error code).
- Persists `url` and `hash` on the claim and emits the same digests in **`ClaimFiled`** for indexers and off-chain tooling.

Tamper evidence and integrity checks are performed **off-chain** (e.g. NestJS verification service, IPFS proxy): download bytes from `url`, hash them, and compare to the stored commitment.

## Frontend / backend

The IPFS or asset proxy should **compute SHA-256** when content is pinned or served and return it to the client so the wallet can pass a correct `hash` into `file_claim`.
