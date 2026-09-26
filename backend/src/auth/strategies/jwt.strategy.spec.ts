import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, JwtPayload } from './jwt.strategy';
import { TokenBlacklistService } from '../token-blacklist.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let mockConfigService: Partial<ConfigService>;
  let mockBlacklistService: Partial<TokenBlacklistService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') return 'test-secret';
        return undefined;
      }),
    };
    mockBlacklistService = {
      isBlacklisted: jest.fn().mockResolvedValue(false),
    };
    strategy = new JwtStrategy(
      mockConfigService as ConfigService,
      mockBlacklistService as TokenBlacklistService,
    );
  });

  it('validate accepts valid payload without jti', async () => {
    const payload: JwtPayload = {
      sub: 'user123',
      walletAddress: 'GXXX...',
    };

    const result = await strategy.validate(payload);

    expect(result.walletAddress).toBe('GXXX...');
    expect(mockBlacklistService.isBlacklisted).not.toHaveBeenCalled();
  });

  it('validate rejects payload without walletAddress', async () => {
    const payload = { sub: 'user123' } as JwtPayload;

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('validate checks blacklist when jti is present', async () => {
    const payload: JwtPayload = {
      sub: 'user123',
      walletAddress: 'GXXX...',
      jti: 'token-id-123',
    };

    await strategy.validate(payload);

    expect(mockBlacklistService.isBlacklisted).toHaveBeenCalledWith('token-id-123');
  });

  it('validate rejects blacklisted tokens', async () => {
    (mockBlacklistService.isBlacklisted as jest.Mock).mockResolvedValueOnce(true);
    const payload: JwtPayload = {
      sub: 'user123',
      walletAddress: 'GXXX...',
      jti: 'blacklisted-token-id',
    };

    await expect(strategy.validate(payload)).rejects.toThrow(
      new UnauthorizedException('Token has been revoked'),
    );
  });

  it('validate accepts non-blacklisted tokens with jti', async () => {
    (mockBlacklistService.isBlacklisted as jest.Mock).mockResolvedValueOnce(false);
    const payload: JwtPayload = {
      sub: 'user123',
      walletAddress: 'GXXX...',
      jti: 'valid-token-id',
    };

    const result = await strategy.validate(payload);

    expect(result.walletAddress).toBe('GXXX...');
  });

  it('validate passes through iat and exp timestamps', async () => {
    const payload: JwtPayload = {
      sub: 'user123',
      walletAddress: 'GXXX...',
      iat: 1234567890,
      exp: 1234567890 + 3600,
    };

    const result = await strategy.validate(payload);

    expect(result.walletAddress).toBe('GXXX...');
  });
});
