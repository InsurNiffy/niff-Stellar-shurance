/**
 * Vote pub/sub — #420
 *
 * Publishes vote events to Redis and provides a GraphQL PubSub adapter
 * so the voteAdded subscription can fan-out to all connected WebSocket clients.
 *
 * Channel format: vote:claim:<claimId>
 *
 * The publisher uses the shared ioredis client.
 * The subscriber uses a dedicated connection (Redis SUBSCRIBE blocks the connection).
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis from 'ioredis';
import { buildRedisConfig } from '../redis/config';

export interface VoteEvent {
  claimId: number;
  voter: string;
  vote: 'yes' | 'no';
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
}

const VOTE_CHANNEL_PREFIX = 'vote:claim:';

@Injectable()
export class VotePubSubService implements OnModuleDestroy {
  readonly pubSub: RedisPubSub;

  constructor() {
    const cfg = buildRedisConfig();
    const createConnection = () => new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password,
      tls: cfg.tls ? {} : undefined,
      db: cfg.db,
      maxRetriesPerRequest: null,
    });

    // Two separate connections: one for publish, one for subscribe
    this.pubSub = new RedisPubSub({
      publisher: createConnection(),
      subscriber: createConnection(),
    });
  }

  /** Publish a vote event. Called by the votes service after a vote is recorded. */
  async publishVote(event: VoteEvent): Promise<void> {
    await this.pubSub.publish(`${VOTE_CHANNEL_PREFIX}${event.claimId}`, {
      voteAdded: event,
    });
  }

  /** Returns the trigger name for a given claimId. */
  static triggerFor(claimId: number): string {
    return `${VOTE_CHANNEL_PREFIX}${claimId}`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pubSub.close();
  }
}
