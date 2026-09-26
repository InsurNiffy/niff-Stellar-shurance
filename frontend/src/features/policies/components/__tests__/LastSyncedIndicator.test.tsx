/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LastSyncedIndicator,
  sanitizeSyncedAt,
  formatLastSynced,
} from '../LastSyncedIndicator';

describe('sanitizeSyncedAt', () => {
  const now = Date.parse('2026-07-25T12:00:00.000Z');

  it('returns null for null/undefined/invalid', () => {
    expect(sanitizeSyncedAt(null, now)).toBeNull();
    expect(sanitizeSyncedAt(undefined, now)).toBeNull();
    expect(sanitizeSyncedAt(NaN, now)).toBeNull();
    expect(sanitizeSyncedAt(0, now)).toBeNull();
    expect(sanitizeSyncedAt(-1, now)).toBeNull();
  });

  it('clamps future timestamps to now', () => {
    const future = now + 60_000;
    const result = sanitizeSyncedAt(future, now);
    expect(result?.getTime()).toBe(now);
  });

  it('passes through valid past timestamps', () => {
    const past = now - 30_000;
    expect(sanitizeSyncedAt(past, now)?.getTime()).toBe(past);
  });
});

describe('formatLastSynced', () => {
  const now = Date.parse('2026-07-25T12:00:00.000Z');

  it('formats relative times', () => {
    expect(formatLastSynced(new Date(now), now)).toBe('just now');
    expect(formatLastSynced(new Date(now - 15_000), now)).toBe('15s ago');
    expect(formatLastSynced(new Date(now - 120_000), now)).toBe('2m ago');
    expect(formatLastSynced(new Date(now - 3_600_000), now)).toBe('1h ago');
  });
});

describe('LastSyncedIndicator', () => {
  it('shows human-readable last-synced label', () => {
    const syncedAt = Date.now() - 45_000;
    render(
      <LastSyncedIndicator syncedAt={syncedAt} onRefresh={jest.fn()} />,
    );
    expect(screen.getByText(/Last synced:/)).toBeInTheDocument();
    expect(screen.getByText(/45s ago|just now|1m ago/)).toBeInTheDocument();
  });

  it('shows never when syncedAt is missing', () => {
    render(<LastSyncedIndicator syncedAt={null} onRefresh={jest.fn()} />);
    expect(screen.getByText(/Last synced: never/)).toBeInTheDocument();
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const onRefresh = jest.fn();
    const user = userEvent.setup();
    render(
      <LastSyncedIndicator syncedAt={Date.now()} onRefresh={onRefresh} />,
    );
    await user.click(screen.getByRole('button', { name: /refresh policy data/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('updates the displayed timestamp after a successful refresh', async () => {
    const user = userEvent.setup();
    let syncedAt = Date.now() - 120_000;
    const onRefresh = jest.fn(() => {
      syncedAt = Date.now();
    });

    const { rerender } = render(
      <LastSyncedIndicator syncedAt={syncedAt} onRefresh={onRefresh} />,
    );
    expect(screen.getByText(/2m ago/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /refresh policy data/i }));
    expect(onRefresh).toHaveBeenCalled();

    rerender(
      <LastSyncedIndicator syncedAt={syncedAt} onRefresh={onRefresh} />,
    );
    expect(screen.getByText(/just now/)).toBeInTheDocument();
  });

  it('never displays a future time when given a future syncedAt', () => {
    const future = Date.now() + 3_600_000;
    render(
      <LastSyncedIndicator syncedAt={future} onRefresh={jest.fn()} />,
    );
    expect(screen.getByText(/just now/)).toBeInTheDocument();
    expect(screen.queryByText(/in /)).not.toBeInTheDocument();
  });
});
