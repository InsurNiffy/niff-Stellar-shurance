/**
 * Feature flag keys shared with the backend.
 *
 * Keys must match `ALLOWED_FLAG_KEYS` in
 * `backend/src/feature-flags/feature-flags.service.ts` verbatim — see
 * `docs/feature-flag-naming-convention.md`. Read them with `useFeatureFlag`.
 *
 * Every UI-gated feature must be listed here. Unknown keys always resolve to
 * `false` (fail closed) so a typo can never accidentally enable an experiment.
 */

export const FEATURE_FLAGS = {
  claims_enabled: 'Claims filing and claims board',
  claims_appeal_enabled: 'Claimant appeal flow (AppealButton + appeal API)',
  policy_creation_enabled: 'New policy creation',
  voting_enabled: 'Claim voting UI',
  ramp_enabled: 'Fiat on/off-ramp',
  graphql_enabled: 'GraphQL API surface',
  tenant_resolution: 'Tenant-aware resolution',
  maintenance_mode: 'Maintenance-mode UI banner',
  ipfs_upload_enabled: 'IPFS evidence uploads',
  quote_simulation_cache_enabled: 'Cached quote simulations',
  experimental_beta_calculators: 'Experimental premium calculators',
  ENABLE_DEV_TOOLS: 'Developer tools',
} as const

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS

/** Keys currently gating a UI surface, with a short description of each gate. */
export const GATED_FEATURES: Record<FeatureFlagKey, string> = FEATURE_FLAGS

/** True when the key is a documented, backend-supported flag. */
export function isKnownFeatureFlag(key: string): key is FeatureFlagKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, key)
}

/** Gates the claimant appeal flow (AppealButton + appeal API). */
export const APPEAL_FEATURE_FLAG: FeatureFlagKey = 'claims_appeal_enabled'
