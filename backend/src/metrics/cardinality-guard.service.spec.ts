import { Test, TestingModule } from '@nestjs/testing';
import { MetricsCardinalityGuard } from './cardinality-guard.service';

describe('MetricsCardinalityGuard', () => {
  let guard: MetricsCardinalityGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsCardinalityGuard],
    }).compile();

    guard = module.get<MetricsCardinalityGuard>(MetricsCardinalityGuard);
  });

  afterEach(() => {
    guard.resetTracking();
  });

  describe('normalizeClaimId', () => {
    it('buckets positive integers into ranges', () => {
      expect(guard.normalizeClaimId(5)).toBe('0-999');
      expect(guard.normalizeClaimId(999)).toBe('0-999');
      expect(guard.normalizeClaimId(1000)).toBe('1000-1999');
      expect(guard.normalizeClaimId(1500)).toBe('1000-1999');
      expect(guard.normalizeClaimId(5000)).toBe('5000-5999');
    });

    it('buckets zero correctly', () => {
      expect(guard.normalizeClaimId(0)).toBe('0-999');
    });

    it('returns "unknown" for non-integers', () => {
      expect(guard.normalizeClaimId(1.5)).toBe('unknown');
      expect(guard.normalizeClaimId(-1)).toBe('unknown');
      expect(guard.normalizeClaimId('123')).toBe('unknown');
      expect(guard.normalizeClaimId(null)).toBe('unknown');
      expect(guard.normalizeClaimId(undefined)).toBe('unknown');
    });
  });

  describe('normalizeTenantId', () => {
    it('preserves well-known tenant IDs', () => {
      expect(guard.normalizeTenantId('default')).toBe('default');
      expect(guard.normalizeTenantId('system')).toBe('system');
    });

    it('hashes unknown tenant IDs to short prefix', () => {
      const result1 = guard.normalizeTenantId('acme-corp-12345');
      expect(result1).toMatch(/^tenant_acme-/);
      expect(result1.length).toBeLessThanOrEqual(15);
    });

    it('returns "unknown" for invalid input', () => {
      expect(guard.normalizeTenantId('')).toBe('unknown');
      expect(guard.normalizeTenantId(null)).toBe('unknown');
      expect(guard.normalizeTenantId(undefined)).toBe('unknown');
      expect(guard.normalizeTenantId(123)).toBe('unknown');
    });

    it('consistently hashes the same tenant ID', () => {
      const tenantId = 'very-long-tenant-id-with-many-chars';
      const result1 = guard.normalizeTenantId(tenantId);
      const result2 = guard.normalizeTenantId(tenantId);
      expect(result1).toBe(result2);
    });
  });

  describe('normalizeHighCardinalityValue', () => {
    it('passes through short strings unchanged', () => {
      expect(guard.normalizeHighCardinalityValue('short')).toBe('short');
      expect(guard.normalizeHighCardinalityValue('a'.repeat(50))).toBe('a'.repeat(50));
    });

    it('hashes long strings to prefix', () => {
      const longString = 'a'.repeat(100);
      const result = guard.normalizeHighCardinalityValue(longString);
      expect(result).toMatch(/^hash_/);
      expect(result.length).toBeLessThanOrEqual(14);
    });

    it('returns "empty" for empty strings', () => {
      expect(guard.normalizeHighCardinalityValue('')).toBe('empty');
    });

    it('returns "unknown" for non-string input', () => {
      expect(guard.normalizeHighCardinalityValue(123)).toBe('unknown');
      expect(guard.normalizeHighCardinalityValue(null)).toBe('unknown');
      expect(guard.normalizeHighCardinalityValue(undefined)).toBe('unknown');
    });

    it('respects custom maxLength', () => {
      const value = 'a'.repeat(30);
      expect(guard.normalizeHighCardinalityValue(value, 20)).toMatch(/^hash_/);
      expect(guard.normalizeHighCardinalityValue(value, 50)).toBe(value);
    });
  });

  describe('checkCardinality', () => {
    it('tracks observed label values', () => {
      guard.checkCardinality('test_label', 'value_1');
      guard.checkCardinality('test_label', 'value_2');
      guard.checkCardinality('test_label', 'value_1'); // duplicate

      const stats = guard.getCardinalityStats();
      expect(stats['test_label']).toBe(2); // only unique values counted
    });

    it('logs warning when cardinality exceeds threshold', () => {
      const warnSpy = jest.spyOn((guard as any).logger, 'warn').mockImplementation(() => undefined);

      // Simulate exceeding MAX_CARDINALITY (1000)
      for (let i = 0; i < 1001; i++) {
        guard.checkCardinality('high_cardinality_label', `value_${i}`);
      }

      expect(warnSpy).toHaveBeenCalled();
      const call = warnSpy.mock.calls[0];
      expect(call[0]).toContain('High cardinality detected');
    });
  });

  describe('getCardinalityStats', () => {
    it('returns cardinality stats for all tracked labels', () => {
      guard.checkCardinality('label_1', 'a');
      guard.checkCardinality('label_1', 'b');
      guard.checkCardinality('label_2', 'x');
      guard.checkCardinality('label_2', 'y');
      guard.checkCardinality('label_2', 'z');

      const stats = guard.getCardinalityStats();
      expect(stats['label_1']).toBe(2);
      expect(stats['label_2']).toBe(3);
    });

    it('returns empty object when no labels tracked', () => {
      const stats = guard.getCardinalityStats();
      expect(stats).toEqual({});
    });
  });

  describe('resetTracking', () => {
    it('clears all tracked cardinality data', () => {
      guard.checkCardinality('label', 'value');
      expect(guard.getCardinalityStats()['label']).toBe(1);

      guard.resetTracking();
      expect(guard.getCardinalityStats()).toEqual({});
    });
  });
});
