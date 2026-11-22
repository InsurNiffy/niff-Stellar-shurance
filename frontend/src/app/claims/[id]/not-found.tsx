import Link from 'next/link'

export default function ClaimNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Claim not found</h1>
      <p className="mt-3 text-muted-foreground">
        The claim you are looking for does not exist or may have been removed.
      </p>
      <Link
        href="/claims"
        className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Back to claims board
      </Link>
    </main>
  )
}
