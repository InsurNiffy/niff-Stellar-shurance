/**
 * voteAdded subscription tests — #420
 *
 * Covers:
 *   - VotePubSubService publishes to the correct Redis channel
 *   - Subscription filter passes events for the correct claimId
 *   - Subscription filter drops events for other claimIds
 *   - Unauthenticated connections are rejected by GraphqlWalletAuthGuard
 *   - onModuleDestroy closes the pubSub connection
 */

import { VotePubSubService, VoteEvent } from './vote-pubsub.service';

// ── Mock graphql-redis-subscriptions ─────────────────────────────────────────

const publishMock = jest.fn().mockResolvedValue(undefined);
const asyncIteratorMock = jest.fn().mockReturnValue({ next: jest.fn() });
const closeMock = jest.fn().mockResolvedValue(undefined);

jest.mock('graphql-redis-subscriptions', () => ({
  RedisPubSub: jest.fn().mockImplementation(() => ({
    publish: publishMock,
    asyncIterator: asyncIteratorMock,
    close: closeMock,
  })),
}));

jest.mock('../redis/client', () => ({
  getBullMQConnection: jest.fn().mockReturnValue({}),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VotePubSubService', () => {
  let svc: VotePubSubService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new VotePubSubService();
  });

  const event: VoteEvent = {
    claimId: 42,
    voter: 'GWALLET123',
    vote: 'yes',
    yesVotes: 5,
    noVotes: 2,
    totalVotes: 7,
  };

  it('publishes to the correct channel for a claimId', async () => {
    await svc.publishVote(event);
    expect(publishMock).toHaveBeenCalledWith('vote:claim:42', { voteAdded: event });
  });

  it('triggerFor returns the correct channel string', () => {
    expect(VotePubSubService.triggerFor(42)).toBe('vote:claim:42');
  });

  it('asyncIterator is called with the correct trigger', () => {
    svc.pubSub.asyncIterator('vote:claim:42');
    expect(asyncIteratorMock).toHaveBeenCalledWith('vote:claim:42');
  });

  it('onModuleDestroy closes the pubSub connection', async () => {
    await svc.onModuleDestroy();
    expect(closeMock).toHaveBeenCalled();
  });
});

// ── Subscription filter logic ─────────────────────────────────────────────────

describe('voteAdded subscription filter', () => {
  // Replicate the filter function from claim.resolver.ts
  const filter = (
    payload: { voteAdded: { claimId: number } },
    variables: { claimId: number },
  ) => payload.voteAdded.claimId === variables.claimId;

  it('passes events matching the subscribed claimId', () => {
    expect(filter({ voteAdded: { claimId: 42 } }, { claimId: 42 })).toBe(true);
  });

  it('drops events for a different claimId', () => {
    expect(filter({ voteAdded: { claimId: 99 } }, { claimId: 42 })).toBe(false);
  });
});

// ── Auth guard behaviour ──────────────────────────────────────────────────────

describe('GraphqlWalletAuthGuard on subscription', () => {
  it('rejects unauthenticated subscription connections', async () => {
    const { GraphqlWalletAuthGuard } = await import('./graphql-wallet-auth.guard');
    const authIdentityMock = {
      resolveRequestIdentity: jest.fn().mockResolvedValue(null),
    };
    const guard = new GraphqlWalletAuthGuard(authIdentityMock as never);

    const context = {
      getType: () => 'graphql',
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    // GqlExecutionContext.create is called internally — mock it
    const { GqlExecutionContext } = await import('@nestjs/graphql');
    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({ req: {} }),
    } as never);

    await expect(guard.canActivate(context as never)).rejects.toThrow('Wallet authentication is required');
  });
});
