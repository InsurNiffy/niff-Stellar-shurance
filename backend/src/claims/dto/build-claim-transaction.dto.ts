import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidateNested,
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

export class ClaimEvidenceItemDto {
  @ApiProperty({
    description: 'Evidence location (e.g. ipfs:// or gateway URL).',
    example: 'ipfs://QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @IsString()
  url!: string;

  @ApiProperty({
    description: 'Lowercase hex SHA-256 of file bytes (64 chars). Prefer value from IPFS upload/proxy.',
    example:
      '0100000000000000000000000000000000000000000000000000000000000000',
  })
  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'contentSha256Hex must be 64 hex characters (32-byte SHA-256)',
  })
  contentSha256Hex!: string;
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
  holder!: string;

  @ApiProperty({
    description: 'The ID of the policy to claim against.',
    example: 1,
  })
  @IsInt()
  @IsPositive()
  policyId!: number;

  @ApiProperty({
    description: 'Claim amount in stroops as an integer string.',
    example: '500000000',
  })
  @IsString()
  @Validate(PositiveIntStringConstraint)
  amount!: string;

  @ApiProperty({
    description: 'Narrative description of the claim.',
    example: 'Water damage in the kitchen due to pipe burst.',
  })
  @IsString()
  @MaxLength(1000)
  details!: string;

  @ApiProperty({
    description:
      'Evidence attachments: URL plus SHA-256 content hash (from proxy when pinning).',
    type: [ClaimEvidenceItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClaimEvidenceItemDto)
  evidence!: ClaimEvidenceItemDto[];
}
