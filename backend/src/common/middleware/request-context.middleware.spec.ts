import { RequestContextMiddleware } from './request-context.middleware';

function run(headers: Record<string, string>) {
  const metrics = {
    correlationIdMissingTotal: { inc: jest.fn() },
    normaliseRoute: (r: string) => r,
    recordHttpRequest: jest.fn(),
  };
  const logger = { structured: jest.fn() };
  const mw = new RequestContextMiddleware(metrics as never, logger as never);
  const set: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (set[k] = v), on: jest.fn() };
  mw.use({ headers, get: () => undefined, path: '/x' } as never, res as never, jest.fn());
  return { set, metrics };
}

describe('RequestContextMiddleware X-Correlation-ID (issue #1633)', () => {
  it('round-trips a custom correlation id', () => {
    const { set, metrics } = run({ 'x-correlation-id': 'abc-123' });
    expect(set['X-Correlation-ID']).toBe('abc-123');
    expect(metrics.correlationIdMissingTotal.inc).not.toHaveBeenCalled();
  });

  it('generates one and counts when missing', () => {
    const { set, metrics } = run({});
    expect(set['X-Correlation-ID']).toBeTruthy();
    expect(metrics.correlationIdMissingTotal.inc).toHaveBeenCalledTimes(1);
  });
});
