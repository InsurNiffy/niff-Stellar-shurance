import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReindexDto {
  @ApiProperty({ description: 'Ledger sequence to reindex from', minimum: 0 })
  @IsInt()
  @Min(0)
  fromLedger!: number;

  @ApiPropertyOptional({
    description:
      'Stellar logical network id (must match STELLAR_NETWORK / indexer cursor row). Defaults to server config.',
    example: 'testnet',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,62}$/i)
  network?: string;
}
