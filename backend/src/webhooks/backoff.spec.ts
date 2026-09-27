import {
  backoffDelayMs,
  computeRetrySchedule,
  DEFAULT_MAX_ATTEMPTS,
  isExhausted,
} from './backoff';

describe('Exponential backoff retry schedule (#1484)', () => {
  it('doubles the delay for each attempt (1s, 2s, 4s, 8s)', () => {
    expect(computeRetrySchedule(5, 1_000)).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('defaults to 5 total attempts', () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(5);
    expect(computeRetrySchedule()).toHaveLength(4);
  });

  it('caps the delay at maxDelayMs', () => {
    expect(backoffDelayMs(10, 1_000, 32_000)).toBe(32_000);
    expect(computeRetrySchedule(10, 1_000, 32_000)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 32_000, 32_000, 32_000,
    ]);
  });

  it('reports when attempts are exhausted', () => {
    expect(isExhausted(5)).toBe(true);
    expect(isExhausted(4)).toBe(false);
    expect(isExhausted(2, 2)).toBe(true);
  });

  it('never schedules a delay for attempt < 1', () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(-3)).toBe(0);
  });
});
