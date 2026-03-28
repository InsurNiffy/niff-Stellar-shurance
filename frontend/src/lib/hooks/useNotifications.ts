"use client";

// Feature: claims-board + claim-status-notifications
// Requirements: 10.1, 10.2, 10.3 (original)
//               + status-change notifications, privacy-safe copy,
//                 in-app toast fallback, mute/snooze per claim

import { useEffect, useRef } from "react";

import type { ClaimFilters } from "@/components/claims/types";
import type { ClaimBoard } from "@/lib/schemas/claims-board";

export interface NotificationPrefs {
  enabled: boolean;
  maxPerMinute?: number; // frequency cap (Req 10.3)
}

/**
 * Pure helper — exported for property testing (Property 17).
 * Returns true when a claim requires the authenticated voter's attention
 * given the active filters.
 */
export function claimNeedsVote(
  claim: ClaimBoard,
  filters: ClaimFilters,
): boolean {
  if (!filters.needsMyVote) return false;
  return claim.status === "Processing" || claim.status === "Pending";
}

// ---------------------------------------------------------------------------
// Privacy-safe notification copy
// ---------------------------------------------------------------------------

/**
 * Returns notification title + body that are safe to display on lock screens
 * and shared devices. No claim amounts, policy details, or personal data.
 */
function buildStatusChangeNotification(update: ClaimStatusUpdate): {
  title: string;
  body: string;
} {
  // Generic copy — does not reveal claim amounts, policy IDs, or outcomes
  // in a way that leaks sensitive data on shared/locked screens.
  return {
    title: "Claim status updated",
    body: "One of your watched claims has a new status. Open the app to view details.",
  };
}

// ---------------------------------------------------------------------------
// In-app toast fallback
// ---------------------------------------------------------------------------

function showToast(update: ClaimStatusUpdate): void {
  toast({
    title: "Claim status updated",
    description: `Claim #${update.claimId} moved to ${update.status}.`,
    duration: 6000,
  });
}

// ---------------------------------------------------------------------------
// Browser notification (only when permission granted)
// ---------------------------------------------------------------------------

function showBrowserNotification(update: ClaimStatusUpdate): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  const { title, body } = buildStatusChangeNotification(update);

  new Notification(title, {
    body,
    // tag deduplicates: a second update for the same claim replaces the first.
    tag: `claim-status-${update.claimId}`,
    // silent: false — let the OS decide; avoids battery-draining vibration loops.
    silent: false,
  });
}

// ---------------------------------------------------------------------------
// Mute / snooze store (per-claim, in-memory; survives re-renders via ref)
// ---------------------------------------------------------------------------

export interface MuteControls {
  /** Mute a claim permanently for this session. */
  mute: (claimId: string) => void;
  /** Snooze a claim for `durationMs` milliseconds. */
  snooze: (claimId: string, durationMs: number) => void;
  /** Returns true if the claim is currently muted or snoozed. */
  isMuted: (claimId: string) => boolean;
}

// ---------------------------------------------------------------------------
// Main hook: vote-filter notifications (original behaviour)
// ---------------------------------------------------------------------------

/**
 * Emits browser notifications for incoming claims that match the active
 * "Needs my vote" filter.
 *
 * - Does NOT notify for every real-time update by default (Req 10.1)
 * - Only notifies when a new claim matching the filter arrives (Req 10.2)
 * - Respects maxPerMinute frequency cap from notificationPrefs (Req 10.3)
 */
export function useNotifications(
  incomingClaims: ClaimBoard[],
  filters: ClaimFilters,
  notificationPrefs?: NotificationPrefs,
): void {
  const notifiedIds = useRef<Set<string>>(new Set());
  const recentTimestamps = useRef<number[]>([]);

  useEffect(() => {
    if (notificationPrefs?.enabled === false) return;
    if (!filters.needsMyVote) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const maxPerMinute = notificationPrefs?.maxPerMinute ?? Infinity;
    const now = Date.now();

    recentTimestamps.current = recentTimestamps.current.filter(
      (t) => now - t < 60_000,
    );

    for (const claim of incomingClaims) {
      if (notifiedIds.current.has(claim.claim_id)) continue;
      if (!claimNeedsVote(claim, filters)) continue;
      if (recentTimestamps.current.length >= maxPerMinute) break;

      new Notification("Claim needs your vote", {
        body: "A claim is open for voting. Open the app to review.",
        tag: `claim-vote-${claim.claim_id}`,
      });

      notifiedIds.current.add(claim.claim_id);
      recentTimestamps.current.push(Date.now());
    }
  }, [incomingClaims, filters, notificationPrefs]);
}

// ---------------------------------------------------------------------------
// Status-change notification hook (watched claims)
// ---------------------------------------------------------------------------

/**
 * Handles a single claim status-change update:
 *  1. Shows a browser notification if permission is granted.
 *  2. Falls back to an in-app toast otherwise.
 *  3. Respects per-claim mute/snooze controls.
 *  4. Respects the global `enabled` flag.
 *
 * Returns MuteControls so callers can wire up per-claim mute/snooze UI.
 */
export function useClaimStatusNotifications(
  enabled: boolean,
): { notify: (update: ClaimStatusUpdate) => void } & MuteControls {
  // muted: permanent for session; snoozed: until timestamp
  const mutedRef = useRef<Set<string>>(new Set());
  const snoozedUntilRef = useRef<Map<string, number>>(new Map());

  const isMuted = useCallback((claimId: string): boolean => {
    if (mutedRef.current.has(claimId)) return true;
    const until = snoozedUntilRef.current.get(claimId);
    if (until !== undefined && Date.now() < until) return true;
    return false;
  }, []);

  const mute = useCallback((claimId: string) => {
    mutedRef.current.add(claimId);
  }, []);

  const snooze = useCallback((claimId: string, durationMs: number) => {
    snoozedUntilRef.current.set(claimId, Date.now() + durationMs);
  }, []);

  const notify = useCallback(
    (update: ClaimStatusUpdate) => {
      if (!enabled) return;
      if (isMuted(update.claimId)) return;

      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        showBrowserNotification(update);
      } else {
        showToast(update);
      }
    },
    [enabled, isMuted],
  );

  return { notify, mute, snooze, isMuted };
}
