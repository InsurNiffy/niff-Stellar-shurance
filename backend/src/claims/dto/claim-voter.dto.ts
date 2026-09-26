import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsString, IsBoolean, IsOptional, Matches } from 'class-validator';

export class ClaimVoterDto {
  @ApiProperty({ description: 'Voter wallet address' })
  @Expose()
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/)
  walletAddress!: string;

  @ApiPropertyOptional({ description: 'Voter display name' })
  @Expose()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ description: 'Whether the voter has voted on this claim' })
  @Expose()
  @IsBoolean()
  voted!: boolean;

  @ApiPropertyOptional({ description: 'Vote direction (yes/no) if voted' })
  @Expose()
  @IsOptional()
  @IsString()
  vote?: 'yes' | 'no';
}
