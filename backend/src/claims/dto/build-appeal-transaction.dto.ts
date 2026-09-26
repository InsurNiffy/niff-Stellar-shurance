import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

/**
 * Request body for POST /claims/:id/appeal/build-transaction.
 * Builds an unsigned file_appeal XDR for wallet signing.
 */
export class BuildAppealTransactionDto {
  @ApiProperty({ description: 'Stellar wallet address of the claimant', example: 'GABC...' })
  @IsString()
  @IsNotEmpty()
  claimant!: string;

  @ApiProperty({ description: 'The claim ID being appealed', example: 42 })
  @IsNumber()
  @Min(0)
  claimId!: number;

  @ApiProperty({
    description: 'Human-readable reason for the appeal',
    example: 'Additional evidence supports the original claim amount.',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
