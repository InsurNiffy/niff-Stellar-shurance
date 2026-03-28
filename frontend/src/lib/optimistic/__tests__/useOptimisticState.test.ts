/// <reference types="jest" />
import { renderHook, act } from '@testing-library/react';
import { useOptimisticState } from '../useOptimisticState';

interface TestData {
  id: string;
  value: string;
}

describe('useOptimisticState', () => {
  const previous: TestData = { id: '1', value: 'original' };
  const optimistic: TestData = { id: '1', value: 'pending' };

  it('apply — adds a pending entry', () => {
    const { result } = renderHook(() => useOptimisticState<TestData>());

    act(() => {
      result.current.apply('1', 'policy_initiation', optimistic, previous, 'tx123');
    });

    const entry = result.current.get('1');
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('pending');
    expect(entry?.optimisticData).toEqual(optimistic);
    expect(entry?.previousData).toEqual(previous);
    expect(entry?.txHash).toBe('tx123');
  });

  it('confirm — transitions pending → confirmed', () => {
    const { result } = renderHook(() => useOptimisticState<TestData>());

    act(() => {
      result.current.apply('1', 'claim_filing', optimistic, previous);
    });
    act(() => {
      result.current.confirm('1');
    });

    expect(result.current.get('1')?.status).toBe('confirmed');
  });

  it('rollback — transitions pending → failed and stores error', () => {
    const { result } = renderHook(() => useOptimisticState<TestData>());

    act(() => {
      result.current.apply('1', 'vote_submission', optimistic, previous);
    });
    act(() => {
      result.current.rollback('1', 'Timed out');
    });

    const entry = result.current.get('1');
    expect(entry?.status).toBe('failed');
    expect(entry?.error).toBe('Timed out');
  });

  it('remove — deletes the entry', () => {
    const { result } = renderHook(() => useOptimisticState<TestData>());

    act(() => {
      result.current.apply('1', 'policy_initiation', optimistic, previous);
    });
    act(() => {
      result.current.remove('1');
    });

    expect(result.current.get('1')).toBeUndefined();
  });

  it('rollback restores previousData reference', () => {
    const { result } = renderHook(() => useOptimisticState<TestData>());

    act(() => {
      result.current.apply('1', 'claim_filing', optimistic, previous);
    });
    act(() => {
      result.current.rollback('1', 'error');
    });

    expect(result.current.get('1')?.previousData).toEqual(previous);
  });

  it('no-op operations on unknown keys do not throw', () => {
    const { result } = renderHook(() => useOptimisticState<TestData>());

    expect(() => {
      act(() => {
        result.current.confirm('unknown');
        result.current.rollback('unknown', 'err');
        result.current.remove('unknown');
      });
    }).not.toThrow();
  });
});
