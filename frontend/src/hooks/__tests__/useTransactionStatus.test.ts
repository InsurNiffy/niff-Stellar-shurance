/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useTransactionStatus } from '../useTransactionStatus';

// Mock getConfig
jest.mock('@/config/env', () => ({
  getConfig: () => ({
    apiUrl: 'https://api.test.com',
    explorerBase: 'https://explorer.test.com/tx',
  }),
}));

// Mock fetch
global.fetch = jest.fn();

describe('useTransactionStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('returns idle state when txHash is null', () => {
    const { result } = renderHook(() => useTransactionStatus(null));
    
    expect(result.current).toEqual({
      status: 'idle',
      error: null,
      explorerUrl: null,
    });
  });

  it('starts polling with pending state when txHash is provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'PENDING' }),
    });

    const { result } = renderHook(() => useTransactionStatus('tx123'));

    expect(result.current.status).toBe('pending');
    
    // Fast-forward initial poll
    jest.advanceTimersByTime(1000);
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/tx/status/tx123');
    });
  });

  it('stops polling on SUCCESS terminal state', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'SUCCESS' }),
    });

    const { result } = renderHook(() => useTransactionStatus('tx-success'));

    // Initial state
    expect(result.current.status).toBe('pending');

    // Advance to first poll
    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(result.current.status).toBe('SUCCESS');
      expect(result.current.explorerUrl).toBe('https://explorer.test.com/tx/tx-success');
      expect(result.current.error).toBeNull();
    });

    // Verify no more polling
    const callCount = (global.fetch as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(10000);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(callCount);
  });

  it('stops polling on FAILED terminal state with error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'FAILED', error: 'Transaction failed: insufficient balance' }),
    });

    const { result } = renderHook(() => useTransactionStatus('tx-failed'));

    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(result.current.status).toBe('FAILED');
      expect(result.current.error).toBe('Transaction failed: insufficient balance');
      expect(result.current.explorerUrl).toBe('https://explorer.test.com/tx/tx-failed');
    });

    // Verify no more polling
    const callCount = (global.fetch as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(10000);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(callCount);
  });

  it('stops polling on NOT_FOUND_TIMEOUT terminal state without explorer URL', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'NOT_FOUND_TIMEOUT' }),
    });

    const { result } = renderHook(() => useTransactionStatus('tx-timeout'));

    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(result.current.status).toBe('NOT_FOUND_TIMEOUT');
      expect(result.current.explorerUrl).toBeNull();
      expect(result.current.error).toBeNull();
    });

    // Verify no more polling
    const callCount = (global.fetch as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(10000);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(callCount);
  });

  it('uses exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)', async () => {
    let callCount = 0;
    (global.fetch as jest.Mock).mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ status: 'PENDING' }),
      };
    });

    renderHook(() => useTransactionStatus('tx-backoff'));

    // 1st poll at 1s
    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(callCount).toBe(1));

    // 2nd poll at +2s
    jest.advanceTimersByTime(2000);
    await waitFor(() => expect(callCount).toBe(2));

    // 3rd poll at +4s
    jest.advanceTimersByTime(4000);
    await waitFor(() => expect(callCount).toBe(3));

    // 4th poll at +8s
    jest.advanceTimersByTime(8000);
    await waitFor(() => expect(callCount).toBe(4));

    // 5th poll at +16s
    jest.advanceTimersByTime(16000);
    await waitFor(() => expect(callCount).toBe(5));

    // 6th poll at +30s (capped, not 32s)
    jest.advanceTimersByTime(30000);
    await waitFor(() => expect(callCount).toBe(6));

    // 7th poll at +30s (stays at cap)
    jest.advanceTimersByTime(30000);
    await waitFor(() => expect(callCount).toBe(7));
  });

  it('transitions from PENDING to SUCCESS', async () => {
    let pollCount = 0;
    (global.fetch as jest.Mock).mockImplementation(async () => {
      pollCount++;
      return {
        ok: true,
        json: async () => ({
          status: pollCount < 3 ? 'PENDING' : 'SUCCESS',
        }),
      };
    });

    const { result } = renderHook(() => useTransactionStatus('tx-transition'));

    // Initial pending
    expect(result.current.status).toBe('pending');

    // 1st poll - PENDING
    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(result.current.status).toBe('pending'));

    // 2nd poll - PENDING
    jest.advanceTimersByTime(2000);
    await waitFor(() => expect(result.current.status).toBe('pending'));

    // 3rd poll - SUCCESS
    jest.advanceTimersByTime(4000);
    await waitFor(() => {
      expect(result.current.status).toBe('SUCCESS');
      expect(result.current.explorerUrl).toBe('https://explorer.test.com/tx/tx-transition');
    });
  });

  it('retries on network error with exponential backoff', async () => {
    let callCount = 0;
    (global.fetch as jest.Mock).mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Network error');
      }
      return {
        ok: true,
        json: async () => ({ status: 'SUCCESS' }),
      };
    });

    const { result } = renderHook(() => useTransactionStatus('tx-retry'));

    // 1st attempt - error
    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(result.current.error).toBe('Network error'));

    // 2nd attempt - error (2s backoff)
    jest.advanceTimersByTime(2000);
    await waitFor(() => expect(callCount).toBe(2));

    // 3rd attempt - success (4s backoff)
    jest.advanceTimersByTime(4000);
    await waitFor(() => {
      expect(result.current.status).toBe('SUCCESS');
      expect(result.current.error).toBeNull();
    });
  });

  it('handles HTTP error responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const { result } = renderHook(() => useTransactionStatus('tx-http-error'));

    jest.advanceTimersByTime(1000);

    await waitFor(() => {
      expect(result.current.error).toContain('HTTP 500');
    });
  });

  it('cleans up timeout on unmount', () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'PENDING' }),
    });

    const { unmount } = renderHook(() => useTransactionStatus('tx-cleanup'));

    jest.advanceTimersByTime(1000);
    
    unmount();

    // Verify no more calls after unmount
    const callCount = (global.fetch as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(10000);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(callCount);
  });

  it('resets state when txHash changes from value to null', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'PENDING' }),
    });

    const { result, rerender } = renderHook(
      ({ hash }) => useTransactionStatus(hash),
      { initialProps: { hash: 'tx-initial' } }
    );

    expect(result.current.status).toBe('pending');

    // Change to null
    rerender({ hash: null });

    expect(result.current).toEqual({
      status: 'idle',
      error: null,
      explorerUrl: null,
    });
  });

  it('restarts polling when txHash changes to new value', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'PENDING' }),
    });

    const { result, rerender } = renderHook(
      ({ hash }) => useTransactionStatus(hash),
      { initialProps: { hash: 'tx-first' } }
    );

    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/tx/status/tx-first'));

    // Change hash
    rerender({ hash: 'tx-second' });

    expect(result.current.status).toBe('pending');
    
    jest.advanceTimersByTime(1000);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('https://api.test.com/tx/status/tx-second'));
  });
});
