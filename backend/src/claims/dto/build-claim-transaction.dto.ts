import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'posIntString', async: false })
class PositiveIntStringConstraint implements ValidatorConstraintInterface {
  validate(value: string) {
    return /^\d+$/.test(value) && BigInt(value) > BigInt(0);
  }
  defaultMessage() {
    return 'amount must be a positive integer string (stroops)';
  }
}

export class BuildClaimTransactionDto {
  @ApiProperty({
    description: 'Stellar public key of the claimant.',
    example: 'GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW',
  })
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'holder must be a valid Stellar public key (G...)',
  })
  holder: string;

  @ApiProperty({
    description: 'The ID of the policy to claim against.',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  policyId: number;

  @ApiProperty({
    description: 'Claim amount in stroops as an integer string.',
    example: '500000000',
  })
  @IsString()
  @Validate(PositiveIntStringConstraint)
  amount: string;

  @ApiProperty({
    description: 'Narrative description of the claim.',
    example: 'Water damage in the kitchen due to pipe burst.',
  })
  @IsString()
  @MaxLength(1000)
  details: string;

  @ApiProperty({
    description: 'List of IPFS URLs (or CIDs) for evidence images.',
    example: ['https://ipfs.io/ipfs/Qm...'],
  })
  @IsArray()
  @IsString({ each: true })
  imageUrls: string[];
}
