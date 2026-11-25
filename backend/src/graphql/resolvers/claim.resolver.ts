import { Args, Context, Query, Resolver } from '@nestjs/graphql';
import DataLoader from 'dataloader';
import { Claim } from '../types/claim.type';
import { ClaimService } from '../../claims/claim.service';
import { GraphQLWalletAuthGuard } from '../guards/graphql-wallet-auth.guard';
import { UseGuards } from '@nestjs/common';

export interface ClaimResolverContext {
  req: { user?: { wallet: string } };
  claimLoader: DataLoader<string, Claim | null>;
}

@Resolver(() => Claim)
@UseGuards(GraphQLWalletAuthGuard)
export class ClaimResolver {
  constructor(private readonly claimService: ClaimService) {}

  @Query(() => Claim, { name: 'claim', nullable: true })
  async claim(
    @Args('id', { type: () => String }) id: string,
    @Context() ctx: ClaimResolverContext,
  ): Promise<Claim | null> {
    return ctx.claimLoader.load(id);
  }

  @Query(() => [Claim], { name: 'claimsByWallet' })
  async claimsByWallet(
    @Context() ctx: ClaimResolverContext,
  ): Promise<Claim[]> {
    const wallet = ctx.req.user?.wallet;
    if (!wallet) {
      return [];
    }
    return this.claimService.findByWallet(wallet);
  }
}
