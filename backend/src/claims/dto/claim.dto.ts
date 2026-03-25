import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class ClaimMetadataDto {
  @ApiProperty({ description: 'Unique claim identifier' })
  @Expose()
  id!: number;

  @ApiProperty({ description: 'Policy ID this claim belongs to' })
  @Expose()
  policyId!: string;

  @ApiProperty({ description: 'Creator wallet address' })
  @Expose()
  creatorAddress!: string;

  @ApiProperty({ description: 'Current claim status' })
  @Expose()
  status!: 'pending' | 'approved' | 'rejected';

  @ApiProperty({ description: 'Claim amount requested' })
  @Expose()
  amount!: string;

  @ApiPropertyOptional({ description: 'Claim description/reason' })
  @Expose()
  description?: string;

  @ApiProperty({ description: 'IPFS hash for evidence' })
  @Expose()
  evidenceHash!: string;

  @ApiProperty({ description: 'Stellar ledger number when created' })
  @Expose()
  createdAtLedger!: number;

  @ApiProperty({ description: 'Creation timestamp' })
  @Expose()
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  @Expose()
  updatedAt!: Date;
}

export class VoteTalliesDto {
  @ApiProperty({ description: 'Number of yes votes' })
  @Expose()
  yesVotes!: number;

  @ApiProperty({ description: 'Number of no votes' })
  @Expose()
  noVotes!: number;

  @ApiProperty({ description: 'Total votes cast' })
  @Expose()
  totalVotes!: number;
}

export class QuorumProgressDto {
  @ApiProperty({ description: 'Required votes for quorum' })
  @Expose()
  required!: number;

  @ApiProperty({ description: 'Current vote count' })
  @Expose()
  current!: number;

  @ApiProperty({ description: 'Progress percentage toward quorum (0-100)' })
  @Expose()
  percentage!: number;

  @ApiProperty({ description: 'Whether quorum has been reached' })
  @Expose()
  reached!: boolean;
}

export class DeadlineDto {
  @ApiProperty({ description: 'Voting deadline ledger number' })
  @Expose()
  votingDeadlineLedger!: number;

  @ApiProperty({ description: 'Voting deadline timestamp' })
  @Expose()
  votingDeadlineTime!: Date;

  @ApiProperty({ description: 'Is voting still open' })
  @Expose()
  isOpen!: boolean;

  @ApiPropertyOptional({ description: 'Time remaining in seconds (null if closed)' })
  @Expose()
  remainingSeconds?: number;
}

export class SanitizedEvidenceDto {
  @ApiProperty({ description: 'IPFS gateway URL' })
  @Expose()
  gatewayUrl!: string;

  @ApiProperty({ description: 'Sanitized IPFS hash' })
  @Expose()
  hash!: string;

  @ApiPropertyOptional({ description: 'Cached content URL (if available)' })
  @Expose()
  cachedUrl?: string;
}

export class ConsistencyMetadataDto {
  @ApiProperty({ description: 'Whether claim is finalized on-chain' })
  @Expose()
  isFinalized!: boolean;

  @ApiPropertyOptional({ description: 'Indexer lag in ledgers (null if synced)' })
  @Expose()
  indexerLag?: number;

  @ApiPropertyOptional({ description: 'Last indexed ledger number' })
  @Expose()
  lastIndexedLedger?: number;

  @ApiProperty({ description: 'Whether data is potentially stale' })
  @Expose()
  isStale!: boolean;
}

export class ClaimListItemDto {
  @ApiProperty({ description: 'Claim metadata' })
  @Expose()
  metadata!: ClaimMetadataDto;

  @ApiProperty({ description: 'Vote tallies' })
  @Expose()
  votes!: VoteTalliesDto;

  @ApiProperty({ description: 'Quorum progress' })
  @Expose()
  quorum!: QuorumProgressDto;

  @ApiProperty({ description: 'Voting deadline information' })
  @Expose()
  deadline!: DeadlineDto;

  @ApiProperty({ description: 'Sanitized evidence URL' })
  @Expose()
  evidence!: SanitizedEvidenceDto;

  @ApiProperty({ description: 'Consistency metadata' })
  @Expose()
  consistency!: ConsistencyMetadataDto;
}

export class PaginationDto {
  @ApiProperty({ description: 'Current page number' })
  @Expose()
  page!: number;

  @ApiProperty({ description: 'Items per page' })
  @Expose()
  limit!: number;

  @ApiProperty({ description: 'Total items' })
  @Expose()
  total!: number;

  @ApiProperty({ description: 'Total pages' })
  @Expose()
  totalPages!: number;

  @ApiProperty({ description: 'Has next page' })
  @Expose()
  hasNext!: boolean;
}

export class ClaimsListResponseDto {
  @ApiProperty({ description: 'Array of claims', type: [ClaimListItemDto] })
  @Expose()
  data!: ClaimListItemDto[];

  @ApiProperty({ description: 'Pagination info', type: PaginationDto })
  @Expose()
  pagination!: PaginationDto;
}

export class ClaimDetailResponseDto extends ClaimListItemDto {
  @ApiPropertyOptional({ description: 'User has voted on this claim' })
  @Expose()
  userHasVoted?: boolean;

  @ApiPropertyOptional({ description: 'User vote (if voted)' })
  @Expose()
  userVote?: 'yes' | 'no';
}
