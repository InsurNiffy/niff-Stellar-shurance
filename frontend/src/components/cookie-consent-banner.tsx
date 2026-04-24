"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  getCookieConsent,
  setCookieConsent,
  CookieConsentValue,
} from "@/lib/cookie-consent";

type ConsentStatus = CookieConsentValue | "unset" | "loading";

export function CookieConsentBanner() {
  const [status, setStatus] = useState<ConsentStatus>("loading");

  useEffect(() => {
    const stored = getCookieConsent();
    setStatus(stored?.value ?? "unset");
  }, []);

  if (status !== "unset") return null;

  function handleChoice(choice: CookieConsentValue) {
    setCookieConsent(choice);
    setStatus(choice);
  }

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 p-4"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-900 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-50">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">Help us improve NiffyInsur</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            We use privacy-friendly analytics to understand product usage. Your
            choice is stored for 365 days.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" onClick={() => handleChoice("accepted")}>
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
