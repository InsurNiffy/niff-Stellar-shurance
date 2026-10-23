import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaimRateLimitGuard } from '../claim-rate-limit.guard';
import { RateLimitService } from '../rate-limit.service';
import { RateLimitException } from '../rate-limit.exception';

const mockHeaders: Record<string, string> = {};
const mockRes = { setHeader: jest.fn((k: string, v: string) => { mockHeaders[k] = v; }) };

function makeCtx(wallet?: string, bodyHolder?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: wallet ? { walletAddress: wallet } : undefined, body: { holder: bodyHolder } }),
      getResponse: () => mockRes,
    }),
  } as unknown as ExecutionContext;
}

describe('ClaimRateLimitGuard', () => {
  let guard: ClaimRateLimitGuard;
  let rateLimitService: jest.Mocked<RateLimitService>;

  beforeEach(() => {
    rateLimitService = {
      checkWalletEvidenceLimit: jest.fn(),
    } as unknown as jest.Mocked<RateLimitService>;

    const config = { get: jest.fn((key: string, def: number) => def) } as unknown as ConfigService;
    guard = new ClaimRateLimitGuard(rateLimitService, config);
    jest.clearAllMocks();
  });

  it('allows request within hourly and daily limits', async () => {
    rateLimitService.checkWalletEvidenceLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    const result = await guard.canActivate(makeCtx('GWALLET'));
    expect(result).toBe(true);
    expect(rateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledTimes(2);
  });

  it('returns 429 with Retry-After and X-RateLimit-* headers when hourly limit exceeded', async () => {
    rateLimitService.checkWalletEvidenceLimit
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 300 });

    await expect(guard.canActivate(makeCtx('GWALLET'))).rejects.toThrow(RateLimitException);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '300');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });

  it('enforces claim filing at 3 per hour per wallet by default', async () => {
    rateLimitService.checkWalletEvidenceLimit
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 1200 });

    await expect(guard.canActivate(makeCtx('GWALLET'))).rejects.toThrow(RateLimitException);
    expect(rateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledWith('claim:hour:GWALLET', 3, 3600);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '1200');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '3');
  });

  it('returns 429 when daily limit exceeded', async () => {
    rateLimitService.checkWalletEvidenceLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3600 });

    await expect(guard.canActivate(makeCtx('GWALLET'))).rejects.toThrow(RateLimitException);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '3600');
  });

  it('rate limits are wallet-scoped (different wallets are independent)', async () => {
    rateLimitService.checkWalletEvidenceLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    await guard.canActivate(makeCtx('GWALLET1'));
    await guard.canActivate(makeCtx('GWALLET2'));
    const calls = rateLimitService.checkWalletEvidenceLimit.mock.calls;
    expect(calls[0][0]).toContain('GWALLET1');
    expect(calls[2][0]).toContain('GWALLET2');
  });

  it('falls through (allows) when no wallet address present', async () => {
    const result = await guard.canActivate(makeCtx());
    expect(result).toBe(true);
    expect(rateLimitService.checkWalletEvidenceLimit).not.toHaveBeenCalled();
  });

  it('extracts wallet from body.holder when no JWT user', async () => {
    rateLimitService.checkWalletEvidenceLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    await guard.canActivate(makeCtx(undefined, 'GHOLDER'));
    expect(rateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledWith(
      expect.stringContaining('GHOLDER'), expect.any(Number), expect.any(Number),
    );
  });
});
