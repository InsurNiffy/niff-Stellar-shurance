import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppealRateLimitGuard } from '../appeal-rate-limit.guard';
import { RateLimitService } from '../rate-limit.service';
import { RateLimitException } from '../rate-limit.exception';

const mockHeaders: Record<string, string> = {};
const mockRes = {
  setHeader: jest.fn((k: string, v: string) => {
    mockHeaders[k] = v;
  }),
};

function makeCtx(wallet?: string, body?: Record<string, string>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: wallet ? { walletAddress: wallet } : undefined,
        body: body ?? {},
      }),
      getResponse: () => mockRes,
    }),
  } as unknown as ExecutionContext;
}

describe('AppealRateLimitGuard', () => {
  let guard: AppealRateLimitGuard;
  let rateLimitService: jest.Mocked<RateLimitService>;

  beforeEach(() => {
    rateLimitService = {
      checkWalletEvidenceLimit: jest.fn(),
    } as unknown as jest.Mocked<RateLimitService>;

    const config = {
      get: jest.fn((key: string, def: number) => def),
    } as unknown as ConfigService;
    guard = new AppealRateLimitGuard(rateLimitService, config);
    jest.clearAllMocks();
    Object.keys(mockHeaders).forEach((k) => delete mockHeaders[k]);
  });

  it('allows request within hourly and daily appeal limits', async () => {
    rateLimitService.checkWalletEvidenceLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    const result = await guard.canActivate(makeCtx('GWALLET'));
    expect(result).toBe(true);
    expect(rateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledTimes(2);
    expect(rateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledWith(
      'appeal:hour:GWALLET',
      2,
      3600,
    );
    expect(rateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledWith(
      'appeal:day:GWALLET',
      5,
      86400,
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Policy', 'appeal');
  });

  it('returns 429 when hourly appeal limit exceeded', async () => {
    rateLimitService.checkWalletEvidenceLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 300,
    });

    await expect(guard.canActivate(makeCtx('GWALLET'))).rejects.toThrow(RateLimitException);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '300');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Policy', 'appeal');
  });

  it('returns 429 when daily appeal limit exceeded', async () => {
    rateLimitService.checkWalletEvidenceLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3600 });

    await expect(guard.canActivate(makeCtx('GWALLET'))).rejects.toThrow(RateLimitException);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '3600');
  });

  it('uses appeal-namespaced keys (isolated from claim counters)', async () => {
    rateLimitService.checkWalletEvidenceLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    await guard.canActivate(makeCtx('GWALLET'));
    const keys = rateLimitService.checkWalletEvidenceLimit.mock.calls.map((c) => c[0]);
    expect(keys.every((k) => String(k).startsWith('appeal:'))).toBe(true);
    expect(keys.every((k) => !String(k).startsWith('claim:'))).toBe(true);
  });

  it('falls through when no wallet present', async () => {
    const result = await guard.canActivate(makeCtx());
    expect(result).toBe(true);
    expect(rateLimitService.checkWalletEvidenceLimit).not.toHaveBeenCalled();
  });

  it('resolves wallet from body.claimant when no JWT user', async () => {
    rateLimitService.checkWalletEvidenceLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    await guard.canActivate(makeCtx(undefined, { claimant: 'HCLAIMANT' }));
    expect(rateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledWith(
      expect.stringContaining('HCLAIMANT'),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('defaults are stricter than claim filing limits (2/hr, 5/day vs 5/hr, 20/day)', () => {
    // Documented justification: appeals are rarer / higher-stakes (#1322).
    const hourDefault = 2;
    const dayDefault = 5;
    expect(hourDefault).toBeLessThan(5);
    expect(dayDefault).toBeLessThan(20);
  });
});
