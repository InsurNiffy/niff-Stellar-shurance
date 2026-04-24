import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { GraphQLISODateTime } from '@nestjs/graphql';

@ObjectType()
export class PolicyNode {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  policyId!: number;

  @Field()
  holderAddress!: string;

  @Field()
  policyType!: string;

  @Field()
  region!: string;

  @Field()
  coverageAmount!: string;

  @Field()
  premium!: string;

  @Field()
  isActive!: boolean;

  @Field(() => Int)
  startLedger!: number;

  @Field(() => Int)
  endLedger!: number;

  @Field({ nullable: true })
  assetContractId?: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType()
export class AdminPolicyNode extends PolicyNode {
  @Field({ nullable: true })
  tenantId?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  deletedAt?: Date | null;
}

@ObjectType()
export class ClaimNode {
  @Field(() => Int)
  id!: number;

  @Field()
  policyId!: string;

  @Field()
  creatorAddress!: string;

  @Field()
  status!: string;

  @Field()
  amount!: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  evidenceHash?: string;

  @Field()
  evidenceGatewayUrl!: string;

  @Field(() => Int)
  createdAtLedger!: number;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => Int)
  yesVotes!: number;

  @Field(() => Int)
  noVotes!: number;

  @Field(() => Int)
  totalVotes!: number;

  @Field(() => Int)
  quorumRequired!: number;

  @Field(() => Int)
  quorumCurrent!: number;

  @Field(() => Int)
  quorumPercentage!: number;

  @Field()
  quorumReached!: boolean;

  @Field(() => Int)
  votingDeadlineLedger!: number;

  @Field(() => GraphQLISODateTime)
  votingDeadlineTime!: Date;

  @Field()
  deadlineOpen!: boolean;

  @Field(() => Int, { nullable: true })
  remainingSeconds?: number;

  @Field()
  isFinalized!: boolean;

  @Field(() => Int)
  indexerLag!: number;

  @Field(() => Int)
  lastIndexedLedger!: number;

  @Field()
  isStale!: boolean;

  @Field()
  tallyReconciled!: boolean;

  @Field({ nullable: true })
  userVote?: string;

  @Field({ nullable: true })
  userHasVoted?: boolean;
}

@ObjectType()
export class PolicyConnectionNode {
  @Field(() => [PolicyNode])
  items!: PolicyNode[];

  @Field({ nullable: true })
  nextCursor!: string | null;

  @Field(() => Int)
  total!: number;
}

@ObjectType()
export class ClaimConnectionNode {
  @Field(() => [ClaimNode])
  items!: ClaimNode[];

  @Field({ nullable: true })
  nextCursor!: string | null;

  @Field(() => Int)
  total!: number;
}

@InputType()
export class PoliciesQueryInput {
  @Field({ nullable: true })
  after?: string;

  @Field(() => Int, { nullable: true })
  first?: number;

  @Field({ nullable: true })
  holderAddress?: string;

  @Field({ nullable: true })
  active?: boolean;
}

@InputType()
export class ClaimsQueryInput {
  @Field({ nullable: true })
  after?: string;

  @Field(() => Int, { nullable: true })
  first?: number;

  @Field({ nullable: true })
  status?: string;
}

@ObjectType()
export class GraphqlViewer {
  @Field()
  authenticated!: boolean;

  @Field({ nullable: true })
  identityKind?: string;

  @Field({ nullable: true })
  walletAddress?: string;

  @Field({ nullable: true })
  staffRole?: string;
}

/** Emitted by the voteAdded subscription on every new vote. */
@ObjectType()
export class VoteAddedEvent {
  @Field(() => Int)
  claimId!: number;

  @Field()
  voter!: string;

  @Field()
  vote!: string;

  @Field(() => Int)
  yesVotes!: number;

  @Field(() => Int)
  noVotes!: number;

  @Field(() => Int)
  totalVotes!: number;
}
