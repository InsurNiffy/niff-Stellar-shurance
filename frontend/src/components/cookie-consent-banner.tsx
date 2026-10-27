"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  getCookieConsent,
  setCookieConsent,
  CookieConsentValue,
} from "@/lib/cookie-consent";

type ConsentStatus = CookieConsentValue | "unset" | "loading";

/**
 * Cookie consent banner — WCAG 2.1 AA compliant.
 *
 * - Blocks analytics.ts and log-shipper.ts until consent is granted
 *   (both modules gate on getConsent() === 'accepted').
 * - Stores consent in localStorage with a version key (COOKIE_CONSENT_VERSION)
 *   so future scope changes can prompt re-consent.
 * - Announces itself via role="dialog" + aria-describedby for screen readers.
 * - Moves focus to the Accept button when it appears.
 */
export function CookieConsentBanner() {
  const [status, setStatus] = useState<ConsentStatus>("loading");
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const stored = getCookieConsent();
    setStatus(stored?.value ?? "unset");
  }, []);

  // Move focus to Accept when the banner first appears
  useEffect(() => {
    if (status === "unset") {
      // Defer past paint so the button is in the tab order
      const id = requestAnimationFrame(() => acceptRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [status]);

  if (status !== "unset") return null;

  function handleChoice(choice: CookieConsentValue) {
    setCookieConsent(choice);
    setStatus(choice);
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      aria-describedby="cookie-consent-description"
      className="fixed inset-x-0 bottom-0 z-50 p-4"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-900 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-50">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold" id="cookie-consent-title">
            Help us improve NiffyInsur
          </p>
          <p
            id="cookie-consent-description"
            className="text-xs text-slate-600 dark:text-slate-300"
          >
            We use privacy-friendly, cookieless analytics to understand product
            usage. Error logs are shipped only with your consent. Your choice is
            stored for 365 days and can be changed in{" "}
            <Link
              href="/settings"
              className="underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Settings
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            ref={acceptRef}
            size="sm"
            onClick={() => handleChoice("accepted")}
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleChoice("declined")}
          >
            Decline
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/privacy">Learn More</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
