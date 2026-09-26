import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';

/** Idle timeout after which a typing signal is considered stale (ms). */
export const TYPING_IDLE_TIMEOUT_MS = 3_000;

export interface TicketTypingState {
  ticketId: string;
  isTyping: boolean;
  staffId: string | null;
  updatedAt: number;
  expiresAt: number;
}

interface InternalState {
  staffId: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * In-memory typing-indicator bus for support tickets.
 *
 * Staff heartbeats refresh a short-lived TTL; if they stop composing or
 * navigate away without clearing, the idle timer clears the signal so it
 * never persists indefinitely.
 */
@Injectable()
export class TypingService implements OnModuleDestroy {
  private readonly logger = new Logger(TypingService.name);
  private readonly states = new Map<string, InternalState>();
  private readonly subjects = new Map<string, Subject<TicketTypingState>>();

  onModuleDestroy() {
    for (const state of this.states.values()) {
      clearTimeout(state.timer);
    }
    this.states.clear();
    for (const subject of this.subjects.values()) {
      subject.complete();
    }
    this.subjects.clear();
  }

  /** Staff began or continued composing a reply. */
  setTyping(ticketId: string, staffId: string): TicketTypingState {
    this.clearTimer(ticketId);

    const expiresAt = Date.now() + TYPING_IDLE_TIMEOUT_MS;
    const timer = setTimeout(() => {
      this.clearTyping(ticketId, 'idle');
    }, TYPING_IDLE_TIMEOUT_MS);

    this.states.set(ticketId, { staffId, expiresAt, timer });
    const payload = this.toPayload(ticketId, true, staffId, expiresAt);
    this.publish(ticketId, payload);
    return payload;
  }

  /**
   * Explicit clear (staff stopped, sent reply, or navigated away).
   * Idempotent when nothing was active.
   */
  clearTyping(ticketId: string, reason: 'explicit' | 'idle' | 'reply' = 'explicit'): TicketTypingState {
    const prev = this.states.get(ticketId);
    this.clearTimer(ticketId);
    this.states.delete(ticketId);

    const payload = this.toPayload(ticketId, false, prev?.staffId ?? null, Date.now());
    if (prev) {
      this.logger.debug(`Typing cleared for ${ticketId} (${reason})`);
      this.publish(ticketId, payload);
    }
    return payload;
  }

  getTyping(ticketId: string): TicketTypingState {
    const state = this.states.get(ticketId);
    if (!state) {
      return this.toPayload(ticketId, false, null, Date.now());
    }
    if (Date.now() >= state.expiresAt) {
      return this.clearTyping(ticketId, 'idle');
    }
    return this.toPayload(ticketId, true, state.staffId, state.expiresAt);
  }

  /** Subscribe to typing changes for a ticket (used by SSE). */
  subscribe(ticketId: string): Subject<TicketTypingState> {
    let subject = this.subjects.get(ticketId);
    if (!subject) {
      subject = new Subject<TicketTypingState>();
      this.subjects.set(ticketId, subject);
    }
    return subject;
  }

  unsubscribe(ticketId: string, subject: Subject<TicketTypingState>) {
    // Only tear down when this is the registry subject and it has no observers left.
    const registered = this.subjects.get(ticketId);
    if (registered === subject && !subject.observed) {
      subject.complete();
      this.subjects.delete(ticketId);
    }
  }

  private publish(ticketId: string, payload: TicketTypingState) {
    const subject = this.subjects.get(ticketId);
    if (subject && !subject.closed) {
      subject.next(payload);
    }
  }

  private clearTimer(ticketId: string) {
    const existing = this.states.get(ticketId);
    if (existing) {
      clearTimeout(existing.timer);
    }
  }

  private toPayload(
    ticketId: string,
    isTyping: boolean,
    staffId: string | null,
    expiresAt: number,
  ): TicketTypingState {
    return {
      ticketId,
      isTyping,
      staffId,
      updatedAt: Date.now(),
      expiresAt,
    };
  }
}
