import Link from 'next/link'

export default function PolicyNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="text-5xl mb-4" aria-hidden="true">📋</p>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Policy not found</h1>
      <p className="text-gray-500 mb-8">
        This policy ID doesn&apos;t exist or may no longer be available. Check the URL and try again.
      </p>
      <Link
        href="/policies"
        className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
      >
        Back to My Policies
      </Link>
    </main>
  )
}
