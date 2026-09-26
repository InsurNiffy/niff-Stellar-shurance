// Feature: claims-board
// Server component — no "use client" directive (Req 4.4: no sensitive data passed to client)
// Requirements: 1.1, 4.4

import type { Metadata } from "next";

import { ClaimsBoard } from "@/components/claims/ClaimsBoard";
import { ScrollToTop } from "@/components/ui/scroll-to-top";

export const metadata: Metadata = {
  title: "Claims Board",
  description: "Browse and vote on insurance claims.",
};

/**
 * /claims page — lightweight server component.
 * Renders the ClaimsBoard client component without passing any sensitive
 * server-side data to the client (Req 4.4).
 */
export default function ClaimsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">
        Claims Board
      </h1>
      <ClaimsBoard />
      <ScrollToTop />
    </main>
  );
}
