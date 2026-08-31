/**
 * Feature flag keys shared with the backend.
 *
 * Keys must match `ALLOWED_FLAG_KEYS` in
 * `backend/src/feature-flags/feature-flags.service.ts` verbatim — see
 * `docs/feature-flag-naming-convention.md`. Read them with `useFeatureFlag`.
 */

/** Gates the claimant appeal flow (AppealButton + appeal API). */
export const APPEAL_FEATURE_FLAG = 'claims_appeal_enabled';
