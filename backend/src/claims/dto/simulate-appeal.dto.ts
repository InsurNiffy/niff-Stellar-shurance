import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Request body for POST /claims/:id/appeal/simulate.
 * Dry-runs file_appeal; does not return signing XDR (#1327).
 */
export class SimulateAppealDto {
  @ApiProperty({
    description: 'Stellar wallet address of the claimant attempting the appeal',
    example: 'GABC...',
  })
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;

  @ApiPropertyOptional({
    description:
      'Optional appeal reason used for the simulation. Defaults to a placeholder; ' +
      'does not affect the Redis cache key (keyed by claimId + walletAddress).',
    example: 'Additional evidence supports the original claim amount.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
