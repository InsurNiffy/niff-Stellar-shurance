/// <reference types="jest" />
import { renderHook, act } from '@testing-library/react';
import { useConfirmationPoller } from '../useConfirmationPoller';
import { CONFIRMATION_TIMEOUT_MS } from '../types';

jest.useFakeTimers();

describe('useConfirmationPoller', () => {
  afterEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  it('calls onConfirmed when check returns true', async () => {
    const check = jest.fn().mockResolvedValue(true);
    const onConfirmed = jest.fn();
    const onRollback = jest.fn();

    renderHook(() =>
      useConfirmationPoller({
        key: 'p1',
        enabled: true,
        createdAt: Date.now(),
        check,
        onConfirmed,
        onRollback,
      }),
    );

    // Let the initial tick run.
    await act(async () => { await Promise.resolve(); });

    expect(onConfirmed).toHaveBeenCalledWith('p1');
    expect(onRollback).not.toHaveBeenCalled();
  });

  it('schedules retry when check returns false', async () => {
    const check = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const onConfirmed = jest.fn();
    const onRollback = jest.fn();

    renderHook(() =>
      useConfirmationPoller({
        key: 'p2',
        enabled: true,
        createdAt: Date.now(),
        check,
        onConfirmed,
        onRollback,
      }),
    );

    await act(async () => { await Promise.resolve(); });
    expect(onConfirmed).not.toHaveBeenCalled();

    // Advance past the first backoff (3 s base).
    await act(async () => {
      jest.advanceTimersByTime(3_500);
      await Promise.resolve();
    });

    expect(onConfirmed).toHaveBeenCalledWith('p2');
  });

  it('calls onRollback when check throws', async () => {
    const check = jest.fn().mockRejectedValue(new Error('HTTP 500'));
    const onConfirmed = jest.fn();
    const onRollback = jest.fn();

    renderHook(() =>
      useConfirmationPoller({
        key: 'p3',
        enabled: true,
        createdAt: Date.now(),
        check,
        onConfirmed,
        onRollback,
      }),
    );

    await act(async () => { await Promise.resolve(); });

    expect(onRollback).toHaveBeenCalledWith('p3', 'HTTP 500');
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('calls onRollback on timeout', async () => {
    const check = jest.fn().mockResolvedValue(false);
    const onConfirmed = jest.fn();
    const onRollback = jest.fn();

    const createdAt = Date.now() - CONFIRMATION_TIMEOUT_MS; // already expired

    renderHook(() =>
      useConfirmationPoller({
        key: 'p4',
        enabled: true,
        createdAt,
        check,
        onConfirmed,
        onRollback,
      }),
    );

    await act(async () => { await Promise.resolve(); });

    expect(onRollback).toHaveBeenCalledWith('p4', expect.stringContaining('timed out'));
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('does nothing when enabled is false', async () => {
    const check = jest.fn();
    const onConfirmed = jest.fn();
    const onRollback = jest.fn();

    renderHook(() =>
      useConfirmationPoller({
        key: 'p5',
        enabled: false,
        createdAt: Date.now(),
        check,
        onConfirmed,
        onRollback,
      }),
    );

    await act(async () => { await Promise.resolve(); });

    expect(check).not.toHaveBeenCalled();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onRollback).not.toHaveBeenCalled();
  });
});
