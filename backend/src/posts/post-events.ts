import { EventEmitter } from 'events';

/** In-process bus for post lifecycle events (same pattern as renewalBus). */
export const postBus = new EventEmitter();

export const POST_PUBLISHED_EVENT = 'post.published';

export interface PostPublishedEvent {
  postId: number;
  title: string;
  authorAddress: string;
  publishedAt: Date;
}
