"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useClaims } from "@/hooks/useClaims";
import QuorumProgressBar from "@/components/claims/QuorumProgressBar";
import EvidenceGallery from "@/components/claims/EvidenceGallery";
import AppealButton from "@/components/claims/AppealButton";
import type { ClaimStatus } from "@/types/claim";

const APPEAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const STATUS_STEPS: ClaimStatus[] = [
  "Open",
  "Voting",
  "Resolved",
  "Rejected",
];

function isWithinAppealWindow(rejectedAt?: string | number): boolean {
  if (!rejectedAt) return false;
  const ts = typeof rejectedAt === "number" ? rejectedAt : Date.parse(rejectedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= APPEAL_WINDOW_MS;
}

export default function ClaimDetailPage({
  params,
}: {
  params: { claimId: string };
}) {
  const { claimId } = params;
  const { claims, isLoading, error, refresh } = useClaims();
  const [now, setNow] = useState(() => Date.now());

  const claim = useMemo(
    () => claims?.find((c) => String(c.id) === claimId),
    [claims, claimId],
  );

  // Poll for live tally updates while the claim is still being voted on.
  useEffect(() => {
    if (!claim || claim.status !== "Voting") return;
    const interval = setInterval(() => {
      refresh?.();
      setNow(Date.now());
    }, 5000);
    return () => clearInterval(interval);
  }, [claim, refresh]);

  if (isLoading && !claim) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Loading claim…
      </div>
    );
  }

  if (error && !claim) {
    return (
      <div className="py-12 text-center text-destructive">
        Failed to load claim. Please try again.
      </div>
    );
  }

  if (!claim) {
    notFound();
  }

  const showAppeal =
    claim.status === "Rejected" &&
    claim.isClaimant &&
    isWithinAppealWindow(claim.rejectedAt);

  const currentStep = STATUS_STEPS.indexOf(claim.status);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/claims"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to claims
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">
            Claim #{claim.id}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Status: <span className="font-medium">{claim.status}</span>
          </p>
        </div>
        {showAppeal && <AppealButton claimId={claim.id} />}
      </div>

      <section aria-labelledby="tally-heading" className="space-y-3">
        <h2 id="tally-heading" className="text-lg font-medium">
          Vote tally
        </h2>
        <QuorumProgressBar
          votesFor={claim.votesFor}
          votesAgainst={claim.votesAgainst}
          quorum={claim.quorum}
        />
      </section>

      <section aria-labelledby="evidence-heading" className="space-y-3">
        <h2 id="evidence-heading" className="text-lg font-medium">
          Evidence
        </h2>
        <EvidenceGallery evidence={claim.evidence ?? []} />
      </section>

      <section aria-labelledby="timeline-heading" className="space-y-3">
        <h2 id="timeline-heading" className="text-lg font-medium">
          Status timeline
        </h2>
        <ol className="flex flex-wrap gap-4">
          {STATUS_STEPS.map((step, index) => {
            const reached = currentStep >= index;
            return (
              <li
                key={step}
                className={
                  "rounded-md border px-3 py-2 text-sm " +
                  (reached
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground")
                }
                aria-current={index === currentStep ? "step" : undefined}
              >
                {step}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
