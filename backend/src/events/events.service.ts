import {
  Injectable,
  Logger,
  MessageEvent,
  OnModuleDestroy,
} from '@nestjs/common';
import { Observable, Subject, interval, merge } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';

/**
 * Shape of a claim update published by the indexer worker over Redis pub/sub.
 * The worker publishes JSON payloads on the `claims:updates` channel whenever
 * it upserts a claim row.
 */
export interface ClaimUpdateEvent {
  claimId: string;
  wallet?: string;
  status?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

const CLAIMS_CHANNEL = 'claims:updates';
const HEARTBEAT_MS = 25_000;
const RETRY_MS = 3_000;

/**
 * Bridges Redis pub/sub claim updates to Server-Sent Events consumers.
 *
 * The service keeps a single in-process Subject that fans out to every
 * connected SSE client. A periodic heartbeat keeps proxies from closing idle
 * connections, and `onModuleDestroy` drains all active streams on shutdown.
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private readonly claimUpdates = new Subject<ClaimUpdateEvent>();
  private readonly shutdown$ = new Subject<void>();
  private activeConnections = 0;

  /**
   * Called by the Redis subscriber when a message arrives on the claims
   * channel. Exposed so the indexer/redis wiring can push updates in without
   * coupling this service to a specific Redis client.
   */
  publishClaimUpdate(payload: ClaimUpdateEvent): void {
    if (!payload || typeof payload.claimId !== 'string') {
      this.logger.warn('Ignoring malformed claim update payload');
      return;
    }
    this.claimUpdates.next(payload);
  }

  /**
   * Handle a raw Redis pub/sub message (JSON string) from the claims channel.
   */
  handleRedisMessage(channel: string, message: string): void {
    if (channel !== CLAIMS_CHANNEL) {
      return;
    }
    try {
      const parsed = JSON.parse(message) as ClaimUpdateEvent;
      this.publishClaimUpdate(parsed);
    } catch (err) {
      this.logger.warn(`Failed to parse claim update: ${(err as Error).message}`);
    }
  }

  /**
   * Build the SSE stream for a single client. When `wallet` is provided the
   * stream is scoped to that wallet's claims; anonymous clients receive all
   * public updates (rate limiting is enforced at the controller/guard layer).
   */
  streamClaimUpdates(wallet?: string): Observable<MessageEvent> {
    this.activeConnections += 1;
    this.logger.debug(
      `SSE client connected (wallet=${wallet ?? 'anonymous'}), active=${this.activeConnections}`,
    );

    const updates$ = this.claimUpdates.pipe(
      filter((event) => !wallet || !event.wallet || event.wallet === wallet),
      map(
        (event): MessageEvent => ({
          type: 'claim-update',
          id: event.claimId,
          retry: RETRY_MS,
          data: event,
        }),
      ),
    );

    const heartbeat$ = interval(HEARTBEAT_MS).pipe(
      map(
        (): MessageEvent => ({
          type: 'heartbeat',
          retry: RETRY_MS,
          data: { ts: new Date().toISOString() },
        }),
      ),
    );

    return merge(updates$, heartbeat$).pipe(
      takeUntil(this.shutdown$),
      // Decrement the counter when the client disconnects or shutdown fires.
      // `finalize` runs on unsubscribe/complete/error.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      (source) =>
        new Observable<MessageEvent>((subscriber) => {
          const sub = source.subscribe(subscriber);
          return () => {
            sub.unsubscribe();
            this.activeConnections = Math.max(0, this.activeConnections - 1);
            this.logger.debug(
              `SSE client disconnected (wallet=${wallet ?? 'anonymous'}), active=${this.activeConnections}`,
            );
          };
        }),
    );
  }

  getActiveConnectionCount(): number {
    return this.activeConnections;
  }

  /**
   * Drain active SSE connections on graceful shutdown so the process can exit
   * cleanly and clients reconnect against a fresh instance.
   */
  onModuleDestroy(): void {
    this.logger.log(
      `Draining ${this.activeConnections} active SSE connection(s) on shutdown`,
    );
    this.shutdown$.next();
    this.shutdown$.complete();
    this.claimUpdates.complete();
  }
}
