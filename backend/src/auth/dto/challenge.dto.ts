import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ChallengeDto {
  @ApiProperty({
    description: 'Stellar Ed25519 public key (G...)',
    example: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
  })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'publicKey must be a valid Stellar public key (G...)' })
  publicKey: string;
}

export class VerifyDto {
  @ApiProperty({ description: 'Stellar public key' })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'publicKey must be a valid Stellar public key (G...)' })
  publicKey: string;

  @ApiProperty({ description: 'UUID nonce returned from POST /auth/challenge' })
  @IsString()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    { message: 'nonce must be a valid UUID v4' },
  )
  nonce: string;

  @ApiProperty({
    description:
      'Base64-encoded 64-byte Ed25519 signature of the challenge message string.',
  })
  @IsString()
  signature: string;
}
