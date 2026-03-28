"use client";

// Feature: claim-status-notifications
// Requirement: Permission UX with clear value explanation, no nag loops

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  shouldPrompt,
  requestPermission,
  suppressPrompt,
  getPermissionState,
} from "@/lib/hooks/useNotificationPermission";

interface Props {
  /** Called after the user grants or denies permission, or dismisses. */
  onDismiss?: () => void;
}

/**
 * One-time banner that politely explains the value of claim notifications
 * and requests browser permission.
 *
 * - Renders nothing if permission is already decided or we've already asked.
 * - Stores a localStorage flag so it never re-appears after dismissal.
 * - "Not now" suppresses the prompt without changing browser permission.
 */
export function NotificationPermissionBanner({ onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    setVisible(shouldPrompt());
  }, []);

  if (!visible) return null;

  async function handleEnable() {
    setRequesting(true);
    await requestPermission();
    setRequesting(false);
    setVisible(false);
    onDismiss?.();
  }

  function handleDismiss() {
    suppressPrompt();
    setVisible(false);
    onDismiss?.();
  }

  return (
    <div
      role="region"
      aria-label="Enable claim notifications"
      className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="font-medium">Stay informed about your claims</p>
        <p className="mt-0.5 text-blue-700">
          Get notified when a claim you&apos;re watching changes status — no
          sensitive details are shown on lock screens.
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button
          size="sm"
          onClick={handleEnable}
          disabled={requesting}
          aria-busy={requesting}
        >
          {requesting ? "Requesting…" : "Enable notifications"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDismiss}
          className="text-blue-700"
        >
          Not now
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings toggle — lets users fully disable the feature at any time
// ---------------------------------------------------------------------------

const SETTINGS_KEY = "niffyinsure:claim-notif-enabled";

export function getClaimNotificationsEnabled(): boolean {
  try {
    const val = localStorage.getItem(SETTINGS_KEY);
    // Default to enabled if the user has granted permission and never toggled.
    if (val === null) return getPermissionState() === "granted";
    return val === "1";
  } catch {
    return false;
  }
}

export function setClaimNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SETTINGS_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

/**
 * Simple settings toggle so users can fully disable claim notifications.
 * Renders inline — embed in a settings page or panel.
 */
export function ClaimNotificationsToggle({ enabled, onChange }: ToggleProps) {
  const permission = getPermissionState();
  const unavailable = permission === "unsupported" || permission === "denied";

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Claim status notifications</p>
        {unavailable && (
          <p className="text-xs text-gray-500 mt-0.5">
            {permission === "denied"
              ? "Notifications are blocked in your browser settings."
              : "Your browser does not support notifications."}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={unavailable}
        onClick={() => onChange(!enabled)}
        className={[
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500",
          enabled && !unavailable ? "bg-blue-600" : "bg-gray-300",
          unavailable ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            enabled && !unavailable ? "translate-x-6" : "translate-x-1",
          ].join(" ")}
        />
        <span className="sr-only">
          {enabled ? "Disable" : "Enable"} claim status notifications
        </span>
      </button>
    </div>
  );
}
