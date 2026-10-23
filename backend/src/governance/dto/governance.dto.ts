import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Shared DTOs for the governance and voter registry API.
 *
 * These mirror the on-chain governance contract: proposal payloads are
 * validated with the same rules the contract enforces before a transaction
 * builder is produced.
 */

export const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export enum ProposalStatus {
  Pending = 'pending',
  Active = 'active',
  Succeeded = 'succeeded',
  Defeated = 'defeated',
  Executed = 'executed',
  Cancelled = 'cancelled',
}

export enum VoteSupport {
  Against = 'against',
  For = 'for',
  Abstain = 'abstain',
}

/** Contract-enforced bounds for proposal payloads. */
export const PROPOSAL_TITLE_MAX_LENGTH = 120;
export const PROPOSAL_DESCRIPTION_MAX_LENGTH = 2000;
export const PROPOSAL_ACTIONS_MAX_LENGTH = 10;

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class VoterDto {
  @ApiProperty({ description: 'Voter address' })
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX)
  address!: string;

  @ApiProperty({ description: 'Voting power (registered weight)' })
  @IsString()
  votingPower!: string;

  @ApiPropertyOptional({ description: 'Address this voter delegated to, if any' })
  @IsOptional()
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX)
  delegatedTo?: string;

  @ApiProperty({ description: 'Ledger at which the voter registered' })
  @IsInt()
  registeredAtLedger!: number;
}

export class VoterListResponseDto {
  @ApiProperty({ type: [VoterDto] })
  @ValidateNested({ each: true })
  @Type(() => VoterDto)
  voters!: VoterDto[];

  @ApiProperty()
  @IsInt()
  total!: number;

  @ApiProperty()
  @IsInt()
  page!: number;

  @ApiProperty()
  @IsInt()
  limit!: number;
}

export class DelegationDto {
  @ApiProperty({ description: 'Delegator address' })
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX)
  delegator!: string;

  @ApiProperty({ description: 'Delegatee address' })
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX)
  delegatee!: string;

  @ApiProperty({ description: 'Delegated voting power' })
  @IsString()
  votingPower!: string;

  @ApiProperty({ description: 'Ledger at which the delegation was recorded' })
  @IsInt()
  delegatedAtLedger!: number;
}

export class DelegationResponseDto {
  @ApiProperty({ type: [DelegationDto] })
  @ValidateNested({ each: true })
  @Type(() => DelegationDto)
  delegations!: DelegationDto[];
}

export class ProposalTallyDto {
  @ApiProperty({ description: 'Voting power in favour' })
  @IsString()
  forVotes!: string;

  @ApiProperty({ description: 'Voting power against' })
  @IsString()
  againstVotes!: string;

  @ApiProperty({ description: 'Voting power abstained' })
  @IsString()
  abstainVotes!: string;
}

export class ProposalDto {
  @ApiProperty()
  @IsInt()
  id!: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty()
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX)
  proposer!: string;

  @ApiProperty({ enum: ProposalStatus })
  @IsEnum(ProposalStatus)
  status!: ProposalStatus;

  @ApiProperty({ type: ProposalTallyDto })
  @ValidateNested()
  @Type(() => ProposalTallyDto)
  tally!: ProposalTallyDto;

  @ApiProperty({ description: 'Ledger at which voting starts' })
  @IsInt()
  startLedger!: number;

  @ApiProperty({ description: 'Ledger at which voting ends' })
  @IsInt()
  endLedger!: number;

  @ApiProperty({
    description:
      'Ledgers remaining before the proposer may submit another proposal (0 when ready)',
  })
  @IsInt()
  @Min(0)
  proposerCooldownRemaining!: number;
}

export class ProposalListResponseDto {
  @ApiProperty({ type: [ProposalDto] })
  @ValidateNested({ each: true })
  @Type(() => ProposalDto)
  proposals!: ProposalDto[];

  @ApiProperty()
  @IsInt()
  total!: number;

  @ApiProperty()
  @IsInt()
  page!: number;

  @ApiProperty()
  @IsInt()
  limit!: number;
}

/**
 * Proposal payload validated with the same rules the contract uses before
 * the `create_proposal` transaction is built.
 */
export class CreateProposalDto {
  @ApiProperty({ maxLength: PROPOSAL_TITLE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @Max(PROPOSAL_TITLE_MAX_LENGTH)
  title!: string;

  @ApiProperty({ maxLength: PROPOSAL_DESCRIPTION_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @Max(PROPOSAL_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiProperty({
    type: [String],
    description: 'Encoded contract actions to execute on success',
    maxItems: PROPOSAL_ACTIONS_MAX_LENGTH,
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Max(PROPOSAL_ACTIONS_MAX_LENGTH, { each: true })
  actions!: string[];
}

export class VoteProposalDto {
  @ApiProperty()
  @IsInt()
  @Min(0)
  proposalId!: number;

  @ApiProperty({ enum: VoteSupport })
  @IsEnum(VoteSupport)
  support!: VoteSupport;
}

export class DelegateVoteDto {
  @ApiProperty({ description: 'Delegator address (transaction source and signer)' })
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX)
  delegator!: string;

  @ApiProperty({ description: 'Ledger sequence (inclusive) at which the delegation expires' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expiryLedger!: number;

  @ApiProperty({ description: 'Address receiving the delegated voting power' })
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX)
  delegatee!: string;
}

export class RevokeVoteDelegationDto {
  @ApiProperty({ description: 'Address whose delegation is being revoked' })
  @IsString()
  @Matches(STELLAR_ADDRESS_REGEX)
  delegatee!: string;
}

export class TransactionBuilderResponseDto {
  @ApiProperty({ description: 'Unsigned transaction XDR' })
  @IsString()
  xdr!: string;

  @ApiProperty({ description: 'Network passphrase the transaction targets' })
  @IsString()
  networkPassphrase!: string;
}
