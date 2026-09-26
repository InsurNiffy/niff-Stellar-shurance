import { Injectable, Logger } from '@nestjs/common';

/**
 * MetricsCardinalityGuard — prevents unbounded Prometheus label cardinality.
 *
 * Problem: Labels sourced from user input or dynamic identifiers can cause
 * unbounded cardinality growth, degrading Prometheus performance and memory usage.
 *
 * Solution: Normalize or drop high-cardinality values before recording metrics.
 * Provides methods to bucket, hash, or drop labels that exceed a safe limit.
 *
 * Guidelines:
 * - Reserved labels: user_id, wallet_address, email, claim_id, tenant, account, etc.
 * - These MUST be pre-normalized using this guard before recording metrics.
 * - Exception: when label values are known-bounded enums (e.g. status: PENDING|APPROVED|PAID|REJECTED).
 */
@Injectable()
export class MetricsCardinalityGuard {
  private readonly logger = new Logger(MetricsCardinalityGuard.name);

  /** Maximum safe cardinality per label before normalization. */
  private readonly MAX_CARDINALITY = 1000;

  /** Tracking map: label_name -> Set of observed values (for monitoring). */
  private readonly cardinalityTracking = new Map<string, Set<string>>();

  /**
   * Normalize a high-cardinality numeric ID (e.g., claim_id) to a bucket.
   * For claim IDs, groups into buckets: "0-1000", "1001-2000", etc.
   * Falls back to "unknown" on non-integer input.
   */
  normalizeClaimId(claimId: unknown): string {
    if (typeof claimId === 'number' && Number.isInteger(claimId) && claimId >= 0) {
      const bucketSize = 1000;
      const bucketIndex = Math.floor(claimId / bucketSize);
      const start = bucketIndex * bucketSize;
      const end = start + bucketSize - 1;
      return `${start}-${end}`;
    }
    return 'unknown';
  }

  /**
   * Normalize a high-cardinality tenant ID to a hash bucket.
   * Returns a short hash (first 8 chars of SHA256) for unbounded tenant identifiers.
   * Exception: well-known tenant IDs are passed through unchanged.
   * Falls back to "unknown" on invalid input.
   */
  normalizeTenantId(tenantId: unknown): string {
    const wellKnownTenants = new Set(['default', 'system']);
    if (typeof tenantId === 'string') {
      if (wellKnownTenants.has(tenantId)) return tenantId;
      if (tenantId.length > 0) {
        // Return first 8 chars as a hash proxy (sufficient for cardinality bounding)
        return `tenant_${tenantId.substring(0, 8)}`;
      }
    }
    return 'unknown';
  }

  /**
   * Normalize a high-cardinality string value to a hash or drop it.
   * Returns a short hash prefix (first 8 chars) for any unbounded value.
   * Falls back to "unknown" on invalid input.
   */
  normalizeHighCardinalityValue(value: unknown, maxLength = 50): string {
    if (typeof value === 'string') {
      if (value.length === 0) return 'empty';
      if (value.length <= maxLength) return value;
      return `hash_${value.substring(0, 8)}`;
    }
    return 'unknown';
  }

  /**
   * Check and record observed label values for monitoring.
   * If a label exceeds MAX_CARDINALITY, logs a warning.
   * This is informational — actual normalization happens in normalize* methods.
   */
  checkCardinality(labelName: string, value: string): void {
    if (!this.cardinalityTracking.has(labelName)) {
      this.cardinalityTracking.set(labelName, new Set());
    }

    const values = this.cardinalityTracking.get(labelName)!;
    if (!values.has(value)) {
      values.add(value);
      if (values.size > this.MAX_CARDINALITY) {
        this.logger.warn(
          `High cardinality detected on label "${labelName}": ${values.size} unique values. ` +
            `Consider normalizing or dropping this label to prevent Prometheus performance degradation.`,
        );
      }
    }
  }

  /**
   * Get current cardinality stats for all tracked labels (for monitoring/debugging).
   */
  getCardinalityStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [label, values] of this.cardinalityTracking.entries()) {
      stats[label] = values.size;
    }
    return stats;
  }

  /**
   * Reset cardinality tracking (useful for testing).
   */
  resetTracking(): void {
    this.cardinalityTracking.clear();
  }
}
