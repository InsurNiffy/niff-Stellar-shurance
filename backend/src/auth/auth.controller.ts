import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WalletAuthService } from './wallet-auth.service';
import { ChallengeDto, VerifyDto } from './dto/challenge.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly walletAuthService: WalletAuthService) {}

  /**
   * POST /api/auth/challenge
   * Issue a domain-bound challenge nonce.
   */
  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'Request a wallet challenge nonce' })
  @ApiResponse({
    status: 200,
    description: 'Challenge issued. Sign the message and POST to /auth/verify.',
  })
  async challenge(@Body() dto: ChallengeDto) {
    return this.walletAuthService.generateChallenge(dto.publicKey);
  }

  /**
   * POST /api/auth/verify
   * Verify Ed25519 signature and issue a scoped JWT.
   * JWT: sub=publicKey, scope=user — no admin capabilities.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 300_000 } })
  @ApiOperation({ summary: 'Verify Ed25519 signature and obtain a JWT' })
  @ApiResponse({
    status: 200,
    description: 'JWT issued. sub=publicKey, scope=user.',
  })
  async verify(@Body() dto: VerifyDto) {
    return this.walletAuthService.verifyChallenge(
      dto.publicKey,
      dto.nonce,
      dto.signature,
    );
  }
}
