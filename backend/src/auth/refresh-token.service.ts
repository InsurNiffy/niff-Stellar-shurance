import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { RedisService } from '../redis/redis.service';

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

export interface IssuedRefreshToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  private get secret(): string {
    return this.configService.get<string>('JWT_REFRESH_SECRET') ?? 'refresh-secret';
  }

  private activeKey(jti: string): string {
    return `auth:refresh:active:${jti}`;
  }

  private blacklistKey(jti: string): string {
    return `auth:refresh:blacklist:${jti}`;
  }

  async issue(userId: string): Promise<IssuedRefreshToken> {
    const jti = randomUUID();
    const token = await this.jwtService.signAsync(
      { sub: userId, jti, type: 'refresh' } as RefreshTokenPayload,
      { secret: this.secret, expiresIn: REFRESH_TTL_SECONDS },
    );

    await this.redisService.set(this.activeKey(jti), userId, REFRESH_TTL_SECONDS);

    return {
      token,
      jti,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    };
  }

  async verify(token: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.secret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const blacklisted = await this.redisService.get(this.blacklistKey(payload.jti));
    if (blacklisted) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const active = await this.redisService.get(this.activeKey(payload.jti));
    if (!active) {
      throw new UnauthorizedException('Refresh token is no longer active');
    }

    return payload;
  }

  async rotate(token: string): Promise<{ userId: string; refresh: IssuedRefreshToken }> {
    const payload = await this.verify(token);

    // Consume the presented token so it cannot be replayed.
    await this.redisService.del(this.activeKey(payload.jti));
    await this.redisService.set(
      this.blacklistKey(payload.jti),
      '1',
      REFRESH_TTL_SECONDS,
    );

    const refresh = await this.issue(payload.sub);
    return { userId: payload.sub, refresh };
  }

  async revoke(token: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.secret,
        ignoreExpiration: true,
      });
    } catch {
      this.logger.warn('Attempted to revoke an unparseable refresh token');
      return;
    }

    if (!payload?.jti) {
      return;
    }

    await this.redisService.del(this.activeKey(payload.jti));
    await this.redisService.set(
      this.blacklistKey(payload.jti),
      '1',
      REFRESH_TTL_SECONDS,
    );
  }
}
