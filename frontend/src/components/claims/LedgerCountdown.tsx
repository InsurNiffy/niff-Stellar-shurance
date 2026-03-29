"use client";

/**
 * LedgerCountdown — converts a target ledger number to a human-readable countdown.
 *
 * The estimate is inherently approximate: ledger close times vary around the
 * network average. The "~" prefix and caveat copy make this explicit to users.
 *
 * avgCloseSeconds must come from the network manifest — never hardcoded here.
 * See: /docs/ledger-time-approximation for the full explanation.
 */

import { useEffect, useState } from "react";

export interface LedgerCountdownProps {
  targetLedger: number;
  currentLedger: number;
  /** Average ledger close time in seconds — sourced from the network manifest. */
  avgCloseSeconds: number;
}

interface Parts {
  days: number;
  hours: number;
  minutes: number;
}

function toParts(totalSeconds: number): Parts {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return { days, hours, minutes };
}

function formatCountdown(parts: Parts): string {
  const segments: string[] = [];
  if (parts.days > 0) segments.push(`${parts.days}d`);
  if (parts.hours > 0 || parts.days > 0) segments.push(`${parts.hours}h`);
  segments.push(`${parts.minutes}m`);
  return `~${segments.join(" ")}`;
}

export function LedgerCountdown({
  targetLedger,
  currentLedger,
  avgCloseSeconds,
}: LedgerCountdownProps) {
  // Use null as the initial state to avoid hydration mismatches.
  // The countdown is only rendered client-side after mount.
  const [mounted, setMounted] = useState(false);
  const [ledger, setLedger] = useState(currentLedger);

  useEffect(() => {
    setMounted(true);
    setLedger(currentLedger);
  }, [currentLedger]);

  useEffect(() => {
    if (!mounted) return;

    const id = setInterval(() => {
      // Advance the estimated current ledger by 1 every avgCloseSeconds.
      setLedger((prev) => prev + 1);
    }, avgCloseSeconds * 1000);

    return () => clearInterval(id);
  }, [mounted, avgCloseSeconds]);

  // Server render: return a stable placeholder to avoid hydration mismatch.
  if (!mounted) {
    return (
      <span className="text-sm text-gray-500" aria-label="Loading countdown">
        —
      </span>
    );
  }

  if (ledger >= targetLedger) {
    return (
      <span className="text-sm font-medium text-gray-500" data-testid="deadline-passed">
        Deadline passed
      </span>
    );
  }

  const remainingLedgers = targetLedger - ledger;
  const remainingSeconds = remainingLedgers * avgCloseSeconds;
  const parts = toParts(remainingSeconds);
  const label = formatCountdown(parts);

  return (
    <span
      className="text-sm font-medium tabular-nums"
      title={`Target ledger: ${targetLedger} · Current: ~${ledger} · ~${avgCloseSeconds}s/ledger`}
      data-testid="ledger-countdown"
    >
      {label}
      <span className="ml-1 text-xs text-gray-400" aria-label="approximate">
        (approximate)
      </span>
    </span>
  );
}
