import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { WalletAuthService } from './wallet-auth.service';
import { ChallengeDto, VerifyDto, NonceQueryDto, VerifyWalletDto } from './dto/challenge.dto';
import { WalletRateLimitGuard } from '../rate-limit/wallet-rate-limit.guard';

class RefreshDto {
  @IsString()
  refreshToken!: string;
}

class LogoutDto {
  @IsString()
  refreshToken!: string;
}

@ApiTags('Auth')
@Controller('auth')
@UseGuards(WalletRateLimitGuard)
export class AuthController {
  constructor(private readonly walletAuthService: WalletAuthService) {}

  /**
   * GET /api/auth/nonce?address=
   * Generate a cryptographically secure one-time nonce for a valid wallet address.
   * Stored in Redis with a 5-minute TTL.
   */
  @Get('nonce')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'Request a wallet challenge nonce (GET)' })
  @ApiQuery({ name: 'address', description: 'Stellar Ed25519 wallet address (G...)' })
  @ApiResponse({
    status: 200,
    description: 'Nonce issued. Sign the message and POST to /auth/verify.',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded. See Retry-After header.' })
  async nonce(@Query() query: NonceQueryDto) {
    return this.walletAuthService.generateChallenge(query.address);
  }

  /**
   * GET /api/auth/challenge?address=
   * Issue a domain-bound challenge nonce (canonical endpoint).
   * The nonce is stored in Redis with a TTL and consumed on first use.
   */
  @Get('challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'Request a wallet challenge nonce (GET)' })
  @ApiQuery({ name: 'address', description: 'Stellar Ed25519 wallet address (G...)' })
  @ApiResponse({
    status: 200,
    description: 'Challenge issued. Sign the message and POST to /auth/verify.',
  })
  async challengeGet(@Query() query: NonceQueryDto) {
    return this.walletAuthService.generateChallenge(query.address);
  }

  /**
   * POST /api/auth/challenge
   * Issue a domain-bound challenge nonce (legacy endpoint — kept for backwards compatibility).
   */
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'Request a wallet challenge nonce' })
  @ApiResponse({
    status: 200,
    description: 'Challenge issued. Sign the message and POST to /auth/verify.',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded. See Retry-After header.' })
  async challenge(@Body() dto: ChallengeDto) {
    return this.walletAuthService.generateChallenge(dto.publicKey);
  }

  /**
   * POST /api/auth/verify
   * Verify Ed25519 signature and issue a scoped JWT.
   * Accepts both { address, signature, nonce } and legacy { publicKey, nonce, signature }.
   * JWT: sub=walletAddress, walletAddress=walletAddress, scope=user — no admin capabilities.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'Verify Ed25519 signature and obtain a JWT' })
  @ApiResponse({
    status: 200,
    description: 'JWT issued. sub=walletAddress, scope=user.',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded. See Retry-After header.' })
  async verify(@Body() dto: VerifyDto | VerifyWalletDto) {
    // Support both { address } (new) and { publicKey } (legacy) field names
    const address = (dto as VerifyWalletDto).address ?? (dto as VerifyDto).publicKey;
    return this.walletAuthService.verifyChallenge(address, dto.nonce, dto.signature);
  }

  /**
   * POST /api/auth/refresh
   * Exchange a valid refresh token for a new access + refresh token pair.
   * The submitted refresh token is immediately invalidated (rotation).
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate refresh token and obtain a new access token' })
  @ApiResponse({ status: 200, description: 'New access + refresh token pair.' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or reused refresh token.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded. See Retry-After header.' })
  async refresh(@Body() dto: RefreshDto) {
    return this.walletAuthService.refresh(dto.refreshToken);
  }

  /**
   * POST /api/auth/logout
   * Immediately revoke the active refresh token.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Revoke refresh token (logout)' })
  @ApiResponse({ status: 204, description: 'Logged out.' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded. See Retry-After header.' })
  async logout(@Body() dto: LogoutDto) {
    await this.walletAuthService.logout(dto.refreshToken);
  }
}
