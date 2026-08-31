#!/usr/bin/env python3
"""Regenerate the fuzz seed corpus from validate.rs's known edge cases.

Each fuzz target parses its raw byte input with a fixed layout (see the
`fuzz_targets/*.rs` files). This script encodes the boundary/edge-case values
already covered by `src/validate.rs` unit tests so the fuzzer starts from a
corpus that exercises every currently-known edge case rather than random bytes.

Usage:
    python3 scripts/gen_seed_corpus.py

To extend the corpus as new edge cases are discovered, add an entry to the
relevant `*_SEEDS` list below and re-run this script. Keep the constants in
sync with `src/types.rs` and `src/validate.rs`.
"""
import os
import struct

# Mirrors src/types.rs — keep in sync when the contract changes.
SAFETY_SCORE_MAX = 100  # types::SAFETY_SCORE_MAX
DETAILS_MAX_LEN = 256   # types::DETAILS_MAX_LEN

I128_MAX = (1 << 127) - 1
U64_MAX = (1 << 64) - 1

CORPUS_DIR = os.path.join(os.path.dirname(__file__), os.pardir, "corpus")


def i128_le(v: int) -> bytes:
    return (v & ((1 << 128) - 1)).to_bytes(16, "little")


def initiate_policy(safety: int, base: int, metadata: bytes = b"ipfs://fuzz") -> bytes:
    # layout: policy_type|region|age|coverage (1 byte each) + safety(u32 le) + base(i128 le) + metadata
    return bytes([2, 2, 2, 2]) + struct.pack("<I", safety & 0xFFFFFFFF) + i128_le(base) + metadata


def file_claim(policy_id: int, amount: int, evidence_flag: int, details: bytes) -> bytes:
    # layout: policy_id(u32 le) + amount(i128 le) + evidence_flag(u8) + details
    return struct.pack("<I", policy_id) + i128_le(amount) + bytes([evidence_flag]) + details


def finalize_claim(claim_id: int) -> bytes:
    # layout: claim_id(u64 le)
    return struct.pack("<Q", claim_id & U64_MAX)


# (name, bytes) — one seed file per known edge case.
INITIATE_POLICY_SEEDS = [
    ("safety_max", initiate_policy(SAFETY_SCORE_MAX, 1_000_000)),        # boundary: highest valid score
    ("safety_over_max", initiate_policy(SAFETY_SCORE_MAX + 1, 1_000_000)),  # SafetyScoreOutOfRange
    ("base_zero", initiate_policy(50, 0)),                              # ZeroPremium
    ("base_negative", initiate_policy(50, -1)),                        # NegativePremiumNotSupported
    ("base_i128_max", initiate_policy(50, I128_MAX)),                  # Overflow
]

FILE_CLAIM_SEEDS = [
    ("amount_zero", file_claim(1, 0, 0, b"edge")),                     # ClaimAmountZero
    ("amount_negative", file_claim(1, -1, 0, b"edge")),               # invalid amount
    ("amount_i128_max", file_claim(1, I128_MAX, 0, b"edge")),         # ClaimExceedsCoverage
    ("details_at_max", file_claim(1, 100_000, 0, b"d" * DETAILS_MAX_LEN)),        # boundary
    ("details_over_max", file_claim(1, 100_000, 0, b"d" * (DETAILS_MAX_LEN + 1))),  # DetailsTooLong
]

FINALIZE_CLAIM_SEEDS = [
    ("claim_id_zero", finalize_claim(0)),                             # ClaimNotFound
    ("claim_id_u64_max", finalize_claim(U64_MAX)),                    # ClaimNotFound (overflow id)
]

TARGETS = {
    "fuzz_initiate_policy": INITIATE_POLICY_SEEDS,
    "fuzz_file_claim": FILE_CLAIM_SEEDS,
    "fuzz_finalize_claim": FINALIZE_CLAIM_SEEDS,
}


def main() -> None:
    for target, seeds in TARGETS.items():
        target_dir = os.path.join(CORPUS_DIR, target)
        os.makedirs(target_dir, exist_ok=True)
        for name, payload in seeds:
            path = os.path.join(target_dir, name)
            with open(path, "wb") as fh:
                fh.write(payload)
            print(f"wrote {os.path.relpath(path, os.path.join(target_dir, os.pardir, os.pardir))} ({len(payload)} bytes)")


if __name__ == "__main__":
    main()
