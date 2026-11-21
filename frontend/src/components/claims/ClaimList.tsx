"use client";

// Feature: claims-board
// Requirements: 7.1, 7.2

import { useState, useRef, useCallback } from "react";

import type { ClaimBoard } from "@/lib/schemas/claims-board";
import type { OptimisticStatus } from "@/lib/optimistic";

import { ClaimRow } from "./ClaimRow";

const ROW_HEIGHT_PX = 120;
const OVERSCAN = 3;
const CONTAINER_HEIGHT_PX = 600;

interface ClaimListProps {
  claims: ClaimBoard[];
  isAuthenticated: boolean;
  onVote?: (claimId: string, vote: "approve" | "reject" | "abstain") => void;
  /** Latest closed ledger (Horizon) for on-chain voting deadline display */
  currentLedger?: number | null;
  /** Enable windowed rendering to keep DOM node count bounded (Req 7.2) */
  virtualize?: boolean;
  /** Optimistic submission state per claim, for immediate "Pending" feedback. */
  optimisticStatuses?: Record<string, { status: OptimisticStatus; error?: string }>;
}

/**
 * Renders a list of ClaimRow items.
 *
 * When `virtualize=true`, only the rows visible in the scroll container plus
 * an overscan buffer are mounted — keeping DOM node count well below the
 * total claim count regardless of dataset size (Req 7.2).
 *
 * When `virtualize=false` (default), all rows are rendered normally (Req 7.1).
 */
export function ClaimList({
  claims,
  isAuthenticated,
  onVote,
  currentLedger = null,
  virtualize = false,
  optimisticStatuses = {},
}: ClaimListProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  if (!virtualize) {
    // Non-virtualized path — render all rows (Req 7.1)
    return (
      <div className="flex flex-col gap-2">
        {claims.map((claim) => (
          <ClaimRow
            key={claim.claim_id}
            claim={claim}
            isAuthenticated={isAuthenticated}
            onVote={onVote}
            currentLedger={currentLedger}
            optimisticStatus={optimisticStatuses[claim.claim_id]}
          />
        ))}
      </div>
    );
  }

  // Virtualized path (Req 7.2)
  const totalHeight = claims.length * ROW_HEIGHT_PX;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN,
  );
  const visibleCount = Math.ceil(CONTAINER_HEIGHT_PX / ROW_HEIGHT_PX);
  const endIndex = Math.min(
    claims.length - 1,
    startIndex + visibleCount + OVERSCAN * 2,
  );

  const visibleClaims = claims.slice(startIndex, endIndex + 1);
  const offsetTop = startIndex * ROW_HEIGHT_PX;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{ height: CONTAINER_HEIGHT_PX, overflowY: "auto" }}
      aria-label="Claims list"
    >
      {/* Spacer that gives the scrollbar the correct total height */}
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: offsetTop, width: "100%" }}>
          {visibleClaims.map((claim) => (
            <div key={claim.claim_id} style={{ height: ROW_HEIGHT_PX }}>
              <ClaimRow
                claim={claim}
                isAuthenticated={isAuthenticated}
                onVote={onVote}
                currentLedger={currentLedger}
                optimisticStatus={optimisticStatuses[claim.claim_id]}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
