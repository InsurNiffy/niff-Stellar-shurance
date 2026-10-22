/**
 * Flags in ALLOWED_FLAG_KEYS that are in the `deprecated` lifecycle stage
 * (see docs/feature-flag-naming-convention.md), keyed by flag with the
 * backend release (package.json `version`) in which they were deprecated.
 *
 * `scripts/check-deprecated-flags.ts` fails CI if a flag stays here for more
 * than one release cycle — delete the guarded code and the flag instead.
 */
export const DEPRECATED_FLAGS: Record<string, string> = {};
