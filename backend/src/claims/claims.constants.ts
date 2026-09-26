/**
 * Feature flag gating the claimant appeal flow (UI + API).
 *
 * Follows docs/feature-flag-naming-convention.md: `<area>_<capability>_enabled`,
 * area prefix `claims_`. The frontend reads the same key verbatim via
 * `useFeatureFlag` so the flag can be staged per environment.
 *
 * Lifecycle: [experimental] — off by default; enable per environment to roll the
 * appeal feature out progressively.
 */
export const APPEAL_FEATURE_FLAG = 'claims_appeal_enabled';
