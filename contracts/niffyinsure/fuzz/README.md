# niffyinsure fuzz targets

`cargo-fuzz` targets for entrypoint input fuzzing. Each target parses raw bytes
into entrypoint arguments with a fixed layout documented at the top of its
`fuzz_targets/*.rs` file.

## Running

```bash
cargo +nightly fuzz run fuzz_initiate_policy
cargo +nightly fuzz run fuzz_file_claim
cargo +nightly fuzz run fuzz_finalize_claim
```

## Seed corpus

`corpus/<target>/` is checked into the repo and seeds each target with the
boundary/edge-case values already covered by `src/validate.rs`'s unit tests, so
fuzzing exercises every currently-known edge case from the first run instead of
starting from random inputs. Seeds encode cases such as:

- **fuzz_initiate_policy** — safety score at and above `SAFETY_SCORE_MAX`, zero /
  negative / `i128::MAX` base premium amounts.
- **fuzz_file_claim** — zero / negative / `i128::MAX` claim amounts, claim
  details at and above `DETAILS_MAX_LEN`.
- **fuzz_finalize_claim** — zero and `u64::MAX` claim ids.

These correspond to previously-fixed validation issues, so the fuzzer should not
immediately fail on them.

## Regenerating / extending the corpus

The seed files are produced by `scripts/gen_seed_corpus.py`:

```bash
python3 scripts/gen_seed_corpus.py
```

To add a newly-discovered edge case, append an entry to the relevant `*_SEEDS`
list in that script and re-run it. Keep the `SAFETY_SCORE_MAX` / `DETAILS_MAX_LEN`
constants in the script in sync with `src/types.rs`.
