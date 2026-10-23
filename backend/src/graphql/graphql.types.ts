import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { GraphQLISODateTime } from '@nestjs/graphql';

@ObjectType()
export class PolicyNode {
  @Field(() => ID)
  id!: string;

  @Field(() => Int)
  policyId!: number;

  @Field(() => String)
  holderAddress!: string;

  @Field(() => String)
  policyType!: string;

  @Field(() => String)
  region!: string;

  @Field(() => String)
  coverageAmount!: string;

  @Field(() => String)
  premium!: string;

  @Field(() => Boolean)
  isActive!: boolean;

  @Field(() => Int)
  startLedger!: number;

  @Field(() => Int)
  endLedger!: number;

  @Field(() => String, { nullable: true })
  assetContractId?: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}

@ObjectType()
export class AdminPolicyNode extends PolicyNode {
  @Field(() => String, { nullable: true })
  tenantId?: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  deletedAt?: Date | null;
}

@ObjectType()
export class ClaimNode {
  @Field(() => Int)
  id!: number;

  @Field(() => String)
  policyId!: string;

  @Field(() => String)
  creatorAddress!: string;

  @Field(() => String)
  status!: string;

  @Field(() => String)
  amount!: string;

  @Field(() => String, { nullable: true })
  description?: string;

  @Field(() => String, { nullable: true })
  evidenceHash?: string;

  @Field(() => String)
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

  @Field(() => Boolean)
  quorumReached!: boolean;

  @Field(() => Int)
  votingDeadlineLedger!: number;

  @Field(() => GraphQLISODateTime)
  votingDeadlineTime!: Date;

  @Field(() => Boolean)
  deadlineOpen!: boolean;

  @Field(() => Int, { nullable: true })
  remainingSeconds?: number;

  @Field(() => Boolean)
  isFinalized!: boolean;

  @Field(() => Int)
  indexerLag!: number;

  @Field(() => Int)
  lastIndexedLedger!: number;

  @Field(() => Boolean)
  isStale!: boolean;

  @Field(() => Boolean)
  tallyReconciled!: boolean;

  @Field(() => String, { nullable: true })
  userVote?: string;

  @Field(() => Boolean, { nullable: true })
  userHasVoted?: boolean;
}

@ObjectType()
export class PolicyConnectionNode {
  @Field(() => [PolicyNode])
  items!: PolicyNode[];

  @Field(() => String, { nullable: true })
  nextCursor!: string | null;

  @Field(() => Int)
  total!: number;
}

@ObjectType()
export class ClaimConnectionNode {
  @Field(() => [ClaimNode])
  items!: ClaimNode[];

  @Field(() => String, { nullable: true })
  nextCursor!: string | null;

  @Field(() => Int)
  total!: number;
}

@InputType()
export class PoliciesQueryInput {
  @Field(() => String, { nullable: true })
  after?: string;

  @Field(() => Int, { nullable: true })
  first?: number;

  @Field(() => String, { nullable: true })
  holderAddress?: string;

  @Field(() => Boolean, { nullable: true })
  active?: boolean;
}

@InputType()
export class ClaimsQueryInput {
  @Field(() => String, { nullable: true })
  after?: string;

  @Field(() => Int, { nullable: true })
  first?: number;

  @Field(() => String, { nullable: true })
  status?: string;
}

@ObjectType()
export class GraphqlViewer {
  @Field(() => Boolean)
  authenticated!: boolean;

  @Field(() => String, { nullable: true })
  identityKind?: string;

  @Field(() => String, { nullable: true })
  walletAddress?: string;

  @Field(() => String, { nullable: true })
  staffRole?: string;
}

/** Emitted by the voteAdded subscription on every new vote. */
@ObjectType()
export class VoteAddedEvent {
  @Field(() => Int)
  claimId!: number;

  @Field(() => String)
  voter!: string;

  @Field(() => String)
  vote!: string;

  @Field(() => Int)
  yesVotes!: number;

  @Field(() => Int)
  noVotes!: number;

  @Field(() => Int)
  totalVotes!: number;
}

@ObjectType()
export class ClaimEscalationTx {
  @Field(() => Int)
  claimId!: number;

  @Field(() => String, { description: 'Unsigned transaction XDR (base64) for the admin wallet to sign' })
  unsignedXdr!: string;
}
