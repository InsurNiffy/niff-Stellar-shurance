import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  IsInt,
  IsPositive,
  IsString,
  IsUUID,
  IsEnum,
  IsOptional,
  IsDate,
  MaxLength,
  Matches,
  ValidateNested,
  IsBoolean,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ClaimMetadataDto {
  @ApiProperty({ description: 'Unique claim identifier' })
  @Expose()
  @IsInt()
  @IsPositive()
  id!: number;

  @ApiProperty({ description: 'Policy ID this claim belongs to' })
  @Expose()
  @IsString()
  @IsUUID()
  policyId!: string;

  @ApiProperty({ description: 'Creator wallet address' })
  @Expose()
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/)
  creatorAddress!: string;

  @ApiProperty({ description: 'Current claim status' })
  @Expose()
  status!: 'pending' | 'approved' | 'paid' | 'rejected';

  @ApiProperty({ description: 'Claim amount requested' })
  @Expose()
  @IsString()
  @Matches(/^\d+$/)
  amount!: string;

  @ApiPropertyOptional({ description: 'Claim description/reason' })
  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ description: 'IPFS hash for evidence' })
  @Expose()
  @IsString()
  @Matches(/^Qm[1-9A-Za-z][1-9A-Za-z0-9]{44}$/i)
  evidenceHash!: string;

  @ApiProperty({ description: 'Stellar ledger number when created' })
  @Expose()
  @IsInt()
  @IsPositive()
  createdAtLedger!: number;

  @ApiProperty({ description: 'Creation timestamp' })
  @Expose()
  @IsDate()
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  @Expose()
  @IsDate()
  updatedAt!: Date;
}

export class VoteTalliesDto {
  @ApiProperty({ description: 'Number of yes votes' })
  @Expose()
  @IsInt()
  @IsPositive()
  yesVotes!: number;

  @ApiProperty({ description: 'Number of no votes' })
  @Expose()
  @IsInt()
  @IsPositive()
  noVotes!: number;

  @ApiProperty({ description: 'Total votes cast' })
  @Expose()
  @IsInt()
  @IsPositive()
  totalVotes!: number;
}

export class QuorumProgressDto {
  @ApiProperty({ description: 'Required votes for quorum' })
  @Expose()
  @IsInt()
  @IsPositive()
  required!: number;

  @ApiProperty({ description: 'Current vote count' })
  @Expose()
  @IsInt()
  @Min(0)
  current!: number;

  @ApiProperty({ description: 'Progress percentage toward quorum (0-100)' })
  @Expose()
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;

  @ApiProperty({ description: 'Whether quorum has been reached' })
  @Expose()
  @IsBoolean()
  reached!: boolean;
}

export class DeadlineDto {
  @ApiProperty({ description: 'Voting deadline ledger number' })
  @Expose()
  @IsInt()
  @IsPositive()
  votingDeadlineLedger!: number;

  @ApiProperty({ description: 'Voting deadline timestamp' })
  @Expose()
  @IsDate()
  votingDeadlineTime!: Date;

  @ApiProperty({ description: 'Is voting still open' })
  @Expose()
  @IsBoolean()
  isOpen!: boolean;

  @ApiPropertyOptional({ description: 'Time remaining in seconds (null if closed)' })
  @Expose()
  @IsOptional()
  @IsNumber()
  remainingSeconds?: number;
}

export class SanitizedEvidenceDto {
  @ApiProperty({ description: 'IPFS gateway URL' })
  @Expose()
@IsString()
  @Matches(/^https?:\/\/.+/i)
  gatewayUrl!: string;

  @ApiProperty({ description: 'Sanitized IPFS hash' })
  @Expose()
  @IsString()
  @Matches(/^Qm[1-9A-Za-z][1-9A-Za-z0-9]{44}$/i)
  hash!: string;

  @ApiPropertyOptional({ description: 'Cached content URL (if available)' })
  @Expose()
@IsOptional()
  @IsString()
  @Matches(/^https?:\/\/.+/i)
  cachedUrl?: string;
}

export class ConsistencyMetadataDto {
  @ApiProperty({ description: 'Whether claim is finalized on-chain' })
  @Expose()
  @IsBoolean()
  isFinalized!: boolean;

  @ApiPropertyOptional({ description: 'Indexer lag in ledgers (null if synced)' })
  @Expose()
  @IsOptional()
  @IsInt()
  @Min(0)
  indexerLag?: number;

  @ApiPropertyOptional({ description: 'Last indexed ledger number' })
  @Expose()
  @IsOptional()
  @IsInt()
  @Min(0)
  lastIndexedLedger?: number;

  @ApiProperty({ description: 'Whether data is potentially stale' })
  @Expose()
  @IsBoolean()
  isStale!: boolean;

  @ApiProperty({
    description:
      'Whether the stored vote tallies reconcile with the count of individual vote rows. ' +
      'False indicates a data-quality issue — display a warning on the claims board.',
  })
  @Expose()
  @IsBoolean()
  tallyReconciled!: boolean;
}

export class ClaimListItemDto {
  @ApiProperty({ description: 'Claim metadata' })
  @Expose()
  @ValidateNested()
  @Type(() => ClaimMetadataDto)
  metadata!: ClaimMetadataDto;

  @ApiProperty({ description: 'Vote tallies' })
  @Expose()
  @ValidateNested()
  @Type(() => VoteTalliesDto)
  votes!: VoteTalliesDto;

  @ApiProperty({ description: 'Quorum progress' })
  @Expose()
  @ValidateNested()
  @Type(() => QuorumProgressDto)
  quorum!: QuorumProgressDto;

  @ApiProperty({ description: 'Voting deadline information' })
  @Expose()
  @ValidateNested()
  @Type(() => DeadlineDto)
  deadline!: DeadlineDto;

  @ApiProperty({ description: 'Sanitized evidence URL' })
  @Expose()
  @ValidateNested()
  @Type(() => SanitizedEvidenceDto)
  evidence!: SanitizedEvidenceDto;

  @ApiProperty({ description: 'Consistency metadata' })
  @Expose()
  @ValidateNested()
  @Type(() => ConsistencyMetadataDto)
  consistency!: ConsistencyMetadataDto;
}

export class CursorPageDto {
  @ApiProperty({
    description:
      'Opaque cursor to pass as `after` for the next page. Null when this is the last page.',
    nullable: true,
    example: 'eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTAxVDAwOjAwOjAwLjAwMFoiLCJpZCI6NDJ9',
  })
  @Expose()
  next_cursor!: string | null;

  @ApiProperty({
    description:
      'Total rows matching the filter before pagination. ' +
      'Eventually consistent — may differ by ±1 under concurrent inserts.',
    example: 42,
  })
  @Expose()
  @IsInt()
  @Min(0)
  total!: number;
}

export class ClaimsListResponseDto {
  @ApiProperty({ description: 'Array of claims', type: [ClaimListItemDto] })
  @Expose()
  @ValidateNested({ each: true })
  @Type(() => ClaimListItemDto)
  data!: ClaimListItemDto[];

  @ApiProperty({ description: 'Cursor pagination metadata', type: CursorPageDto })
  @Expose()
  pagination!: CursorPageDto;
}

export class ClaimDetailResponseDto extends ClaimListItemDto {
  @ApiPropertyOptional({ description: 'User has voted on this claim' })
  @Expose()
  userHasVoted?: boolean;

  @ApiPropertyOptional({ description: 'User vote (if voted)' })
  @Expose()
  userVote?: 'yes' | 'no';
}
