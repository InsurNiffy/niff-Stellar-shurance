import DataLoader from 'dataloader';
import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Args, Context, Int, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import type { Policy } from '@prisma/client';
import { AuthIdentityService } from '../auth/auth-identity.service';
import { ClaimsService } from '../claims/claims.service';
import type { ClaimDetailResponseDto } from '../claims/dto/claim.dto';
import { PolicyReadService } from '../policy/policy-read.service';
import type { GraphqlContext, GraphqlRequest } from './graphql.context';
import { GraphqlRateLimitGuard } from './graphql-rate-limit.guard';
import { ClaimNode, GraphqlViewer, PolicyConnectionNode, PolicyNode } from './graphql.types';

type ClaimsByPolicyKey = {
  policyId: string;
  first: number;
};

@Resolver(() => PolicyNode)
export class PolicyResolver {
  private readonly claimsByPolicyLoaders = new WeakMap<
    GraphqlRequest,
    DataLoader<ClaimsByPolicyKey, ClaimNode[]>
  >();
  private readonly nestedClaimsDefaultLimit: number;
  private readonly nestedClaimsMaxLimit: number;

  constructor(
    private readonly policyReadService: PolicyReadService,
    private readonly claimsService: ClaimsService,
    private readonly authIdentity: AuthIdentityService,
    config: ConfigService,
  ) {
    this.nestedClaimsDefaultLimit = config.get<number>('GRAPHQL_POLICY_CLAIMS_DEFAULT_LIMIT', 10);
    this.nestedClaimsMaxLimit = config.get<number>('GRAPHQL_POLICY_CLAIMS_MAX_LIMIT', 25);
  }

  @Query(() => PolicyConnectionNode)
  @UseGuards(GraphqlRateLimitGuard)
  async policies(
    @Args('after', { nullable: true }) after?: string,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('holderAddress', { nullable: true }) holderAddress?: string,
    @Args('active', { nullable: true }) active?: boolean,
  ): Promise<PolicyConnectionNode> {
    const page = await this.policyReadService.listPolicies({
      after,
      first,
      holderAddress,
      active,
    });

    return {
      items: page.items.map((policy) => this.toPolicyNode(policy)),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  @Query(() => PolicyNode, { nullable: true })
  @UseGuards(GraphqlRateLimitGuard)
  async policy(@Args('id') id: string): Promise<PolicyNode> {
    return this.toPolicyNode(await this.policyReadService.getPolicyById(id));
  }

  @Query(() => GraphqlViewer)
  async viewer(@Context() ctx: GraphqlContext): Promise<GraphqlViewer> {
    const identity = await this.authIdentity.resolveRequestIdentity(ctx.req);

    if (!identity) {
      return { authenticated: false };
    }

    if (identity.kind === 'wallet') {
      return {
        authenticated: true,
        identityKind: 'wallet',
        walletAddress: identity.walletAddress,
      };
    }

    return {
      authenticated: true,
      identityKind: 'staff',
      staffRole: identity.role,
    };
  }

  @ResolveField(() => [ClaimNode], { name: 'claims' })
  async claims(
    @Parent() policy: PolicyNode,
    @Args('first', { type: () => Int, nullable: true }) first: number | undefined,
    @Context() ctx: GraphqlContext,
  ): Promise<ClaimNode[]> {
    const loader = this.getClaimsByPolicyLoader(ctx.req);
    const limit = this.clampNestedClaimsLimit(first);
    return loader.load({ policyId: policy.id, first: limit });
  }

  private getClaimsByPolicyLoader(
    req: GraphqlRequest,
  ): DataLoader<ClaimsByPolicyKey, ClaimNode[]> {
    const existing = this.claimsByPolicyLoaders.get(req);
    if (existing) {
      return existing;
    }

    const loader = new DataLoader<ClaimsByPolicyKey, ClaimNode[]>(
      async (keys) => {
        const groups = new Map<number, string[]>();
        for (const key of keys) {
          const bucket = groups.get(key.first) ?? [];
          bucket.push(key.policyId);
          groups.set(key.first, bucket);
        }

        const groupedResults = new Map<string, ClaimNode[]>();
        for (const [first, policyIds] of groups.entries()) {
          const claimsByPolicy = await this.claimsService.getClaimsByPolicyIds(policyIds, first);
          for (const [policyId, claims] of claimsByPolicy.entries()) {
            groupedResults.set(
              `${policyId}:${first}`,
              claims.map((claim) => this.toClaimNode(claim)),
            );
          }
        }

        return keys.map((key) => groupedResults.get(`${key.policyId}:${key.first}`) ?? []);
      },
      {
        cacheKeyFn: (key) => `${key.policyId}:${key.first}`,
      },
    );

    this.claimsByPolicyLoaders.set(req, loader);
    return loader;
  }

  private toPolicyNode(policy: Policy): PolicyNode {
    return {
      id: policy.id,
      policyId: policy.policyId,
      holderAddress: policy.holderAddress,
      policyType: policy.policyType,
      region: policy.region,
      coverageAmount: policy.coverageAmount,
      premium: policy.premium,
      isActive: policy.isActive,
      startLedger: policy.startLedger,
      endLedger: policy.endLedger,
      assetContractId: policy.assetContractId,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }

  private toClaimNode(claim: ClaimDetailResponseDto): ClaimNode {
    return {
      id: claim.metadata.id,
      policyId: claim.metadata.policyId,
      creatorAddress: claim.metadata.creatorAddress,
      status: claim.metadata.status,
      amount: claim.metadata.amount,
      description: claim.metadata.description,
      evidenceHash: claim.evidence.hash,
      evidenceGatewayUrl: claim.evidence.gatewayUrl,
      createdAtLedger: claim.metadata.createdAtLedger,
      createdAt: claim.metadata.createdAt,
      updatedAt: claim.metadata.updatedAt,
      yesVotes: claim.votes.yesVotes,
      noVotes: claim.votes.noVotes,
      totalVotes: claim.votes.totalVotes,
      quorumRequired: claim.quorum.required,
      quorumCurrent: claim.quorum.current,
      quorumPercentage: claim.quorum.percentage,
      quorumReached: claim.quorum.reached,
      votingDeadlineLedger: claim.deadline.votingDeadlineLedger,
      votingDeadlineTime: claim.deadline.votingDeadlineTime,
      deadlineOpen: claim.deadline.isOpen,
      remainingSeconds: claim.deadline.remainingSeconds,
      isFinalized: claim.consistency.isFinalized,
      indexerLag: claim.consistency.indexerLag,
      lastIndexedLedger: claim.consistency.lastIndexedLedger,
      isStale: claim.consistency.isStale,
      tallyReconciled: claim.consistency.tallyReconciled,
      userVote: claim.userVote,
      userHasVoted: claim.userHasVoted,
    };
  }

  private clampNestedClaimsLimit(first?: number): number {
    return Math.min(
      Math.max(1, first ?? this.nestedClaimsDefaultLimit),
      this.nestedClaimsMaxLimit,
    );
  }
}
