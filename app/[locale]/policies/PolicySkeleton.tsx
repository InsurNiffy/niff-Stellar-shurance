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
