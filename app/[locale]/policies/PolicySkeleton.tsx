export function PolicySkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading policies"
      className="animate-pulse rounded-lg border border-gray-200 p-4"
    >
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 rounded bg-gray-200" />
        <div className="h-5 w-16 rounded-full bg-gray-200" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-48 rounded bg-gray-200" />
        <div className="h-3 w-40 rounded bg-gray-200" />
        <div className="h-3 w-24 rounded bg-gray-200" />
      </div>
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
