import DataLoader from 'dataloader';
import { UnauthorizedException, UseGuards } from '@nestjs/common';
import { Args, Context, Int, Parent, Query, ResolveField, Resolver, Subscription } from '@nestjs/graphql';
import type { Policy } from '@prisma/client';
import { AuthIdentityService } from '../auth/auth-identity.service';
import { ClaimsService } from '../claims/claims.service';
import type { ClaimDetailResponseDto } from '../claims/dto/claim.dto';
import { PolicyReadService } from '../policy/policy-read.service';
import type { GraphqlContext, GraphqlRequest } from './graphql.context';
import { GraphqlRateLimitGuard } from './graphql-rate-limit.guard';
import { GraphqlWalletAuthGuard } from './graphql-wallet-auth.guard';
import { ClaimConnectionNode, ClaimNode, PolicyNode, VoteAddedEvent } from './graphql.types';
import { VotePubSubService } from './vote-pubsub.service';

@Resolver(() => ClaimNode)
export class ClaimResolver {
  private readonly policyLoaders = new WeakMap<GraphqlRequest, DataLoader<string, PolicyNode | null>>();

  constructor(
    private readonly claimsService: ClaimsService,
    private readonly policyReadService: PolicyReadService,
    private readonly authIdentity: AuthIdentityService,
    private readonly votePubSub: VotePubSubService,
  ) {}

  @Query(() => ClaimConnectionNode)
  @UseGuards(GraphqlRateLimitGuard)
  async claims(
    @Args('after', { nullable: true }) after?: string,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Args('status', { nullable: true }) status?: string,
  ): Promise<ClaimConnectionNode> {
    const page = await this.claimsService.listClaims({ after, limit: first, status });
    return {
      items: page.data.map((claim) => this.toClaimNode(claim)),
      nextCursor: page.pagination.next_cursor,
      total: page.pagination.total,
    };
  }

  @Query(() => ClaimNode, { nullable: true })
  @UseGuards(GraphqlRateLimitGuard)
  async claim(
    @Args('id', { type: () => Int }) id: number,
    @Context() ctx: GraphqlContext,
  ): Promise<ClaimNode> {
    const identity = await this.authIdentity.resolveRequestIdentity(ctx.req);
    const walletAddress = identity?.kind === 'wallet' ? identity.walletAddress : undefined;
    return this.toClaimNode(await this.claimsService.getClaimById(id, walletAddress));
  }

  @Query(() => ClaimConnectionNode)
  @UseGuards(GraphqlRateLimitGuard, GraphqlWalletAuthGuard)
  async claimsNeedingMyVote(
    @Args('after', { nullable: true }) after?: string,
    @Args('first', { type: () => Int, nullable: true }) first?: number,
    @Context() ctx?: GraphqlContext,
  ): Promise<ClaimConnectionNode> {
    const identity = await this.authIdentity.resolveRequestIdentity(ctx!.req);
    const walletAddress = identity?.kind === 'wallet' ? identity.walletAddress : '';
    const page = await this.claimsService.getClaimsNeedingVote(walletAddress, {
      after,
      limit: first,
    });

    return {
      items: page.data.map((claim) => this.toClaimNode(claim)),
      nextCursor: page.pagination.next_cursor,
      total: page.pagination.total,
    };
  }

  @ResolveField(() => PolicyNode, { name: 'policy', nullable: true })
  async policy(
    @Parent() claim: ClaimNode,
    @Context() ctx: GraphqlContext,
  ): Promise<PolicyNode | null> {
    const loader = this.getPolicyLoader(ctx.req);
    return loader.load(claim.policyId);
  }

  private getPolicyLoader(req: GraphqlRequest): DataLoader<string, PolicyNode | null> {
    const existing = this.policyLoaders.get(req);
    if (existing) {
      return existing;
    }

    const loader = new DataLoader<string, PolicyNode | null>(async (ids) => {
      const policies = await this.policyReadService.getPoliciesByIds(ids);
      return ids.map((id) => {
        const policy = policies.get(id);
        return policy ? this.toPolicyNode(policy) : null;
      });
    });

    this.policyLoaders.set(req, loader);
    return loader;
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

  /**
   * subscription voteAdded(claimId: Int!): VoteAddedEvent
   *
   * Authenticated: requires a valid wallet JWT (Authorization: Bearer <token>).
   * Unauthenticated connections are rejected before the subscription is established.
   *
   * The subscription is backed by Redis pub/sub via VotePubSubService.
   * Each subscriber receives events only for the requested claimId.
   * The connection is cleaned up automatically when the WebSocket closes.
   *
   * Authentication flow:
   *   1. Client connects via WebSocket with `connectionParams: { Authorization: "Bearer <jwt>" }`.
   *   2. The Apollo subscription context factory resolves the identity.
   *   3. GraphqlWalletAuthGuard rejects unauthenticated connections with UNAUTHENTICATED.
   */
  @Subscription(() => VoteAddedEvent, {
    filter: (payload: { voteAdded: VoteAddedEvent }, variables: { claimId: number }) =>
      payload.voteAdded.claimId === variables.claimId,
  })
  @UseGuards(GraphqlWalletAuthGuard)
  voteAdded(
    @Args('claimId', { type: () => Int }) claimId: number,
  ): AsyncIterator<VoteAddedEvent> {
    if (!claimId || claimId <= 0) {
      throw new UnauthorizedException('Invalid claimId');
    }
    return this.votePubSub.pubSub.asyncIterator(
      VotePubSubService.triggerFor(claimId),
    );
  }
}
