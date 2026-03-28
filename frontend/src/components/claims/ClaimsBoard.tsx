"use client";

// Feature: claims-board
// Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.3, 6.1, 6.5, 9.2, 10.x

import React, { useState, useCallback, useRef, useEffect } from "react";

import { useAuth } from "@/lib/hooks/useAuth";
import { useClaimsData } from "@/lib/hooks/useClaimsData";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useQueryParamFilters } from "@/lib/hooks/useQueryParamFilters";
import { useRealtimeTallies } from "@/lib/hooks/useRealtimeTallies";
import type { ClaimBoard } from "@/lib/schemas/claims-board";

import { ClaimList } from "./ClaimList";
import { FilterBar } from "./FilterBar";
import { PaginationControls } from "./PaginationControls";
import type { ClaimFilters, TallyUpdate } from "./types";


// ---------------------------------------------------------------------------
// ClaimsBoard
// ---------------------------------------------------------------------------

export function ClaimsBoard() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const { isAuthenticated, onExpiry } = useAuth();

  // ── Filter state (synced to URL) ──────────────────────────────────────────
  const [filters, setFilters] = useQueryParamFilters();

  // ── Pagination ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);

  // ── Re-auth prompt ────────────────────────────────────────────────────────
  const [showReauthPrompt, setShowReauthPrompt] = useState(false);

  // ── JWT expiry handler (Req 4.3) ──────────────────────────────────────────
  // When the JWT expires: deactivate "Needs my vote", clear auth UI, prompt re-auth.
  const handleExpiry = useCallback(() => {
    onExpiry();
    setFilters({ ...filters, needsMyVote: false });
    setShowReauthPrompt(true);
  }, [onExpiry, filters, setFilters]);

  // Register the expiry handler once; re-register when handleExpiry changes.
  // We do this via a ref so we don't need to re-subscribe useAuth.
  const handleExpiryRef = useRef(handleExpiry);
  useEffect(() => {
    handleExpiryRef.current = handleExpiry;
  });

  // ── Fetch claims ──────────────────────────────────────────────────────────
  const {
    claims: fetchedClaims,
    totalPages,
    loading,
    error,
    retry,
  } = useClaimsData(filters, page);

  // ── Local claims state (for tally updates) ────────────────────────────────
  // We keep a Map of tally patches so we can apply targeted tally updates
  // without causing infinite loops from fetchedClaims reference changes.
  const [tallyPatches, setTallyPatches] = useState<
    Map<string, Partial<ClaimBoard>>
  >(new Map());

  // Reset patches when filters/page change (new fetch = fresh data).
  const prevFiltersRef = useRef(filters);
  const prevPageRef = useRef(page);
  useEffect(() => {
    if (prevFiltersRef.current !== filters || prevPageRef.current !== page) {
      prevFiltersRef.current = filters;
      prevPageRef.current = page;
      setTallyPatches(new Map());
    }
  }, [filters, page]);

  // Merge fetched claims with any tally patches.
  const localClaims = fetchedClaims.map((claim) => {
    const patch = tallyPatches.get(claim.claim_id);
    return patch ? { ...claim, ...patch } : claim;
  });

  // ── Notifications (Req 10.1, 10.2, 10.3) ─────────────────────────────────
  useNotifications(localClaims, filters);

  // ── Claim status change notifications ────────────────────────────────────
  const [notifEnabled, setNotifEnabled] = useState(false);
  // Read from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    setNotifEnabled(getClaimNotificationsEnabled());
  }, []);

  const { notify } = useClaimStatusNotifications(notifEnabled);

  // Watch all currently visible claim IDs for status changes.
  useClaimWatcher({
    claimIds: claimIds,
    onStatusChange: notify,
    enabled: notifEnabled,
  });

  // ── Real-time tally updates (Req 6.1, 6.5) ────────────────────────────────
  const claimIds = localClaims.map((c) => c.claim_id);

  const handleTallyUpdate = useCallback((update: TallyUpdate) => {
    // Apply update ONLY to the claim with the matching claimId (Req 6.5).
    setTallyPatches((prev) => {
      const next = new Map(prev);
      next.set(update.claimId, {
        approve_votes: update.approveVotes,
        reject_votes: update.rejectVotes,
        status: update.status as ClaimBoard["status"],
      });
      return next;
    });
  }, []);

  useRealtimeTallies(claimIds, handleTallyUpdate);

  const latestLedger = useLatestLedger();

  // ── Filter change resets page to 1 ───────────────────────────────────────
  const handleFiltersChange = useCallback(
    (newFilters: ClaimFilters) => {
      setFilters(newFilters);
      setPage(1);
    },
    [setFilters],
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Notification permission banner — shown once, never nagged */}
      <NotificationPermissionBanner
        onDismiss={() => setNotifEnabled(getClaimNotificationsEnabled())}
      />

      {/* Settings toggle (inline; move to a settings page as needed) */}
      <ClaimNotificationsToggle
        enabled={notifEnabled}
        onChange={(v) => {
          setClaimNotificationsEnabled(v);
          setNotifEnabled(v);
        }}
      />
      {/* Re-auth prompt (Req 4.3) */}
      {showReauthPrompt && (
        <div
          role="alert"
          className="rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800"
        >
          Your session has expired. Please{" "}
          <button
            type="button"
            onClick={() => setShowReauthPrompt(false)}
            className="underline font-medium focus:outline-none focus:ring-2 focus:ring-yellow-600"
          >
            sign in again
          </button>{" "}
          to continue voting.
        </div>
      )}

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        onChange={handleFiltersChange}
        showNeedsMyVote={isAuthenticated}
      />

      {/* Main content area */}
      <section aria-label="Claims list" aria-live="polite" aria-atomic="false">
        {loading && (
          <div
            role="status"
            aria-label="Loading claims"
            className="flex justify-center py-12"
          >
            <span
              aria-hidden="true"
              className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"
            />
            <span className="sr-only">Loading claims…</span>
          </div>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <p className="font-medium">Failed to load claims</p>
            <p className="mt-1">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-2 rounded border border-red-600 px-3 py-1.5 text-xs font-medium text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 min-h-[44px]"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && localClaims.length === 0 && (
          <div
            role="status"
            className="rounded-md border border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-500"
          >
            No claims match the current filters.
          </div>
        )}

        {!loading && !error && localClaims.length > 0 && (
          <ClaimList
            claims={localClaims}
            isAuthenticated={isAuthenticated}
            currentLedger={latestLedger}
          />
        )}
      </section>

      {/* Pagination */}
      {!loading && !error && totalPages > 1 && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
