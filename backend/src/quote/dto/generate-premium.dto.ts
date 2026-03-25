import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export enum PolicyTypeEnum {
  Auto = 'Auto',
  Health = 'Health',
  Property = 'Property',
}

export enum RegionTierEnum {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
}

export class GeneratePremiumDto {
  @ApiProperty({ enum: PolicyTypeEnum })
  @IsEnum(PolicyTypeEnum, {
    message: "policy_type must be one of: 'Auto', 'Health', 'Property'",
  })
  policy_type: PolicyTypeEnum;

  @ApiProperty({ enum: RegionTierEnum })
  @IsEnum(RegionTierEnum, {
    message: "region must be one of: 'Low', 'Medium', 'High'",
  })
  region: RegionTierEnum;

  @ApiProperty({ minimum: 1, maximum: 120, description: 'Policyholder age in years' })
  @IsInt()
  @Min(1)
  @Max(120)
  age: number;

  @ApiProperty({ minimum: 1, maximum: 10, description: 'Risk score 1–10 (higher = riskier)' })
  @IsInt()
  @Min(1)
  @Max(10)
  risk_score: number;

  @ApiPropertyOptional({
    description:
      'Stellar public key for live Soroban simulation. Omit to use local computation.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'source_account must be a valid Stellar public key (G...)',
  })
  source_account?: string;
}
