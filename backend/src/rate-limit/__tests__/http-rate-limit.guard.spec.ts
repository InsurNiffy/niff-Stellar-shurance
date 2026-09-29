import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { HttpRateLimitGuard } from '../http-rate-limit.guard';
import { RateLimitService } from '../rate-limit.service';

const mockRateLimitService = {
  checkWalletEvidenceLimit: jest.fn(),
};

const mockReflector = {
  getAllAndOverride: jest.fn(),
};

function buildCtx(opts: {
  policyName?: string;
  walletAddress?: string;
  ip?: string;
  forwarded?: string;
}): ExecutionContext {
  const headers: Record<string, string> = {};
  if (opts.forwarded) headers['x-forwarded-for'] = opts.forwarded;

  const req = {
    user: opts.walletAddress ? { walletAddress: opts.walletAddress } : undefined,
    socket: { remoteAddress: opts.ip ?? '127.0.0.1' },
    headers,
  };
  const res = { setHeader: jest.fn() };

  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('HttpRateLimitGuard', () => {
  let guard: HttpRateLimitGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new HttpRateLimitGuard(
      mockReflector as unknown as Reflector,
      mockRateLimitService as unknown as RateLimitService,
    );
  });

  it('allows exempt routes without calling the service', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('exempt');
    const ctx = buildCtx({ policyName: 'exempt' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockRateLimitService.checkWalletEvidenceLimit).not.toHaveBeenCalled();
  });

  it('allows request when within limits', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('claim-filing');
    mockRateLimitService.checkWalletEvidenceLimit.mockResolvedValueOnce({
      allowed: true,
      retryAfterSeconds: 0,
    });
    const ctx = buildCtx({ walletAddress: 'GCNXYZ' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('returns 429 with Retry-After when limit is exceeded', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('claim-filing');
    mockRateLimitService.checkWalletEvidenceLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const ctx = buildCtx({ walletAddress: 'GCNXYZ' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('keys by wallet address for authenticated requests', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('claim-filing');
    mockRateLimitService.checkWalletEvidenceLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    const ctx = buildCtx({ walletAddress: 'GCWALLET123', ip: '1.2.3.4' });
    await guard.canActivate(ctx);
    expect(mockRateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledWith(
      expect.stringContaining('GCWALLET123'),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('keys by IP for unauthenticated requests', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('auth-challenge');
    mockRateLimitService.checkWalletEvidenceLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    const ctx = buildCtx({ ip: '1.2.3.4' });
    await guard.canActivate(ctx);
    expect(mockRateLimitService.checkWalletEvidenceLimit).toHaveBeenCalledWith(
      expect.stringContaining('1.2.3.4'),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('fails open when Redis is unavailable', async () => {
    mockReflector.getAllAndOverride.mockReturnValue('default');
    mockRateLimitService.checkWalletEvidenceLimit.mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );
    const ctx = buildCtx({ ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
