import { createHash } from 'crypto';
import type { GeneratePremiumDto } from './dto/generate-premium.dto';

/**
 * Canonical JSON for cache keys: fixed key order (sorted) and normalized scalars.
 * Changing this function invalidates all existing quote cache entries.
 */
export function buildNormalizedQuoteCanonicalJson(dto: GeneratePremiumDto): string {
  const normalized: Record<string, string | number> = {
    age: dto.age,
    coverage_tier: dto.coverage_tier,
    policy_type: dto.policy_type,
    region: dto.region,
    risk_score: dto.risk_score,
    source_account: dto.source_account ?? '',
  };
  const keys = Object.keys(normalized).sort() as (keyof typeof normalized)[];
  const sorted: Record<string, string | number> = {};
  for (const k of keys) {
    sorted[k] = normalized[k];
  }
  return JSON.stringify(sorted);
}

/** SHA-256 hex digest scoped by contract + network so environments do not collide. */
export function buildQuoteSimulationCacheKeyHash(
  dto: GeneratePremiumDto,
  contractId: string,
  networkPassphrase: string,
): string {
  const canonical = buildNormalizedQuoteCanonicalJson(dto);
  return createHash('sha256')
    .update(contractId)
    .update('\0')
    .update(networkPassphrase)
    .update('\0')
    .update(canonical)
    .digest('hex');
}
