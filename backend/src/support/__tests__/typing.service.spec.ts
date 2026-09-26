import { TYPING_IDLE_TIMEOUT_MS, TypingService } from '../typing.service';

describe('TypingService', () => {
  let service: TypingService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new TypingService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('reports no typing for tickets with no active staff', () => {
    const state = service.getTyping('ticket-1');
    expect(state.isTyping).toBe(false);
    expect(state.staffId).toBeNull();
  });

  it('sets typing when staff begins composing', () => {
    const state = service.setTyping('ticket-1', 'staff-a');
    expect(state.isTyping).toBe(true);
    expect(state.staffId).toBe('staff-a');
    expect(service.getTyping('ticket-1').isTyping).toBe(true);
  });

  it('clears typing after idle timeout', () => {
    service.setTyping('ticket-1', 'staff-a');
    jest.advanceTimersByTime(TYPING_IDLE_TIMEOUT_MS);
    expect(service.getTyping('ticket-1').isTyping).toBe(false);
  });

  it('never persists indefinitely when staff navigates away without clearing', () => {
    service.setTyping('ticket-1', 'staff-a');
    // Simulate abandon: no further heartbeats
    jest.advanceTimersByTime(TYPING_IDLE_TIMEOUT_MS + 1);
    expect(service.getTyping('ticket-1').isTyping).toBe(false);
  });

  it('clears typing on explicit stop / reply', () => {
    service.setTyping('ticket-1', 'staff-a');
    const cleared = service.clearTyping('ticket-1', 'reply');
    expect(cleared.isTyping).toBe(false);
    expect(service.getTyping('ticket-1').isTyping).toBe(false);
  });

  it('heartbeat refreshes the idle window', () => {
    service.setTyping('ticket-1', 'staff-a');
    jest.advanceTimersByTime(TYPING_IDLE_TIMEOUT_MS - 500);
    service.setTyping('ticket-1', 'staff-a');
    jest.advanceTimersByTime(TYPING_IDLE_TIMEOUT_MS - 500);
    expect(service.getTyping('ticket-1').isTyping).toBe(true);
    jest.advanceTimersByTime(TYPING_IDLE_TIMEOUT_MS);
    expect(service.getTyping('ticket-1').isTyping).toBe(false);
  });

  it('publishes updates to SSE subscribers', () => {
    const events: boolean[] = [];
    const subject = service.subscribe('ticket-1');
    const sub = subject.subscribe((s) => events.push(s.isTyping));

    service.setTyping('ticket-1', 'staff-a');
    service.clearTyping('ticket-1', 'explicit');

    expect(events).toEqual([true, false]);
    sub.unsubscribe();
  });
});
