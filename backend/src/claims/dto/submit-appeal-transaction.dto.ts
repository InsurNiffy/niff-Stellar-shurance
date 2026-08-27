import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for POST /claims/:id/appeal.
 * Accepts a signed Soroban transaction XDR and an idempotency key.
 */
export class SubmitAppealTransactionDto {
  @ApiProperty({ description: 'Base64-encoded signed transaction XDR' })
  @IsString()
  @IsNotEmpty()
  transactionXdr!: string;

  /**
   * Idempotency key: the SHA-256 hash of the signed XDR (produced client-side).
   * If the same hash has already been processed, the cached result is returned.
   */
  @ApiProperty({
    description:
      'SHA-256 hex hash of the transactionXdr. ' +
      'Repeated submissions with the same txHash return the cached result without re-incrementing appealsCount.',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  txHash!: string;
}
