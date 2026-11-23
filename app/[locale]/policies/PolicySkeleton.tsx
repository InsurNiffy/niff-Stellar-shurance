export function SkeletonRow({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-4 ${className}`}
    >
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 rounded bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-3 w-48 rounded bg-gray-200 motion-safe:animate-pulse" />
      </div>
      <div className="h-5 w-16 rounded-full bg-gray-200 motion-safe:animate-pulse" />
    </div>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg border border-gray-200 p-4 ${className}`}
    >
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 rounded bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-5 w-16 rounded-full bg-gray-200 motion-safe:animate-pulse" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-48 rounded bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-3 w-40 rounded bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-3 w-24 rounded bg-gray-200 motion-safe:animate-pulse" />
      </div>
    </div>
  );
}

export function SkeletonDetail({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-6 ${className}`}>
      <div className="space-y-3">
        <div className="h-6 w-2/3 rounded bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-4 w-1/3 rounded bg-gray-200 motion-safe:animate-pulse" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-3 w-full rounded bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-3 w-5/6 rounded bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-3 w-4/6 rounded bg-gray-200 motion-safe:animate-pulse" />
      </div>
      <div className="flex gap-3">
        <div className="h-9 w-24 rounded-md bg-gray-200 motion-safe:animate-pulse" />
        <div className="h-9 w-24 rounded-md bg-gray-200 motion-safe:animate-pulse" />
      </div>
    </div>
  );
}

export function PolicySkeleton() {
  return (
    <div role="status" aria-label="Loading policies">
      <SkeletonCard />
    </div>
  );
}

export function PolicySkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <PolicySkeleton key={index} />
      ))}
    </div>
  );
}

type EmptyStateProps = {
  headline: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  illustration: "policies" | "claims" | "transactions";
};

function EmptyIllustration({
  variant,
}: {
  variant: EmptyStateProps["illustration"];
}) {
  const common = "h-24 w-24 text-gray-300 motion-safe:animate-pulse";
  if (variant === "claims") {
    return (
      <svg
        className={common}
        viewBox="0 0 96 96"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="16" y="20" width="64" height="56" rx="6" />
        <path d="M16 36h64" />
        <path d="M32 52h32M32 64h20" />
      </svg>
    );
  }
  if (variant === "transactions") {
    return (
      <svg
        className={common}
        viewBox="0 0 96 96"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="48" cy="48" r="28" />
        <path d="M48 32v16l12 8" />
      </svg>
    );
  }
  return (
    <svg
      className={common}
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M24 16h36l16 16v48a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4Z" />
      <path d="M60 16v16h16" />
      <path d="M32 48h32M32 60h24" />
    </svg>
  );
}

export function EmptyState({
  headline,
  description,
  ctaLabel,
  ctaHref,
  illustration,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-gray-300 p-10 text-center">
      <EmptyIllustration variant={illustration} />
      <h2 className="text-lg font-semibold text-gray-900">{headline}</h2>
      <p className="max-w-md text-sm text-gray-600">{description}</p>
      <a
        href={ctaHref}
        className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {ctaLabel}
      </a>
    </div>
  );
}

export function PoliciesEmptyState() {
  return (
    <EmptyState
      illustration="policies"
      headline="No policies yet"
      description="Create your first policy to start protecting what matters to you."
      ctaLabel="Create policy"
      ctaHref="/policies/new"
    />
  );
}

export function ClaimsEmptyState() {
  return (
    <EmptyState
      illustration="claims"
      headline="No claims filed"
      description="When you file a claim, you'll be able to track its progress here."
      ctaLabel="File a claim"
      ctaHref="/claims/new"
    />
  );
}

export function TransactionsEmptyState() {
  return (
    <EmptyState
      illustration="transactions"
      headline="No transactions yet"
      description="Your transaction history will appear here once you make your first payment."
      ctaLabel="Make a payment"
      ctaHref="/payments/new"
    />
  );
}
