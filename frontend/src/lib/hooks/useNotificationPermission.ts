"use client";

// Feature: claim-status-notifications
// Requirements: permission UX, no nag loops, respect denial

const STORAGE_KEY = "niffyinsure:notif-permission-asked";

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

/**
 * Returns the current browser Notification permission state.
 * Returns "unsupported" when the Notification API is unavailable.
 */
export function getPermissionState(): PermissionState {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as PermissionState;
}

/**
 * Returns true if we should show the permission prompt banner.
 * Conditions:
 *  - API is available
 *  - Permission is still "default" (not yet decided)
 *  - We have NOT already asked this session/device (localStorage flag)
 */
export function shouldPrompt(): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "default") return false;
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

/**
 * Requests browser notification permission once.
 * Records that we asked so we never prompt again (even across sessions).
 * Returns the resulting permission state.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (typeof Notification === "undefined") return "unsupported";

  // Mark as asked before the prompt so a page reload never re-prompts.
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // localStorage unavailable — proceed anyway; worst case we ask once more.
  }

  const result = await Notification.requestPermission();
  return result as PermissionState;
}

/**
 * Permanently suppresses the prompt banner (user clicked "Not now").
 * Does NOT change the browser permission — just stops us from asking again.
 */
export function suppressPrompt(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}
