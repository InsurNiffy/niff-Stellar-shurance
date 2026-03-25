import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PolicyTypeEnum, RegionTierEnum } from '../../quote/dto/generate-premium.dto';

@ValidatorConstraint({ name: 'posIntString', async: false })
class PositiveIntStringConstraint implements ValidatorConstraintInterface {
  validate(value: string) {
    return /^\d+$/.test(value) && BigInt(value) > BigInt(0);
  }
  defaultMessage() {
    return 'coverage must be a positive integer string (stroops)';
  }
}

export class BuildTransactionDto {
  @ApiProperty({
    description: 'Stellar public key of the policyholder.',
    example: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
  })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'holder must be a valid Stellar public key (G...)',
  })
  holder: string;

  @ApiProperty({ enum: PolicyTypeEnum })
  @IsEnum(PolicyTypeEnum)
  policy_type: PolicyTypeEnum;

  @ApiProperty({ enum: RegionTierEnum })
  @IsEnum(RegionTierEnum)
  region: RegionTierEnum;

  @ApiProperty({
    description:
      'Max payout in stroops as an integer string. E.g. "1000000000" = 100 XLM.',
    example: '1000000000',
  })
  @IsString()
  @Validate(PositiveIntStringConstraint)
  coverage: string;

  @ApiProperty({ minimum: 1, maximum: 120 })
  @IsInt()
  @Min(1)
  @Max(120)
  age: number;

  @ApiProperty({ minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  risk_score: number;

  @ApiPropertyOptional({
    description: 'Policy start ledger. Defaults to current ledger.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  start_ledger?: number;

  @ApiPropertyOptional({
    description: 'Duration in ledgers (≈5 s/ledger). Defaults to ~1 year (1_051_200).',
    maximum: 2_102_400,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(2_102_400)
  duration_ledgers?: number;
}
