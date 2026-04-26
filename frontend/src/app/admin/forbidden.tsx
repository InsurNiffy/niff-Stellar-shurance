import Link from 'next/link'

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-6xl font-bold text-destructive">403</p>
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="text-muted-foreground max-w-sm">
        You do not have permission to view this page. Staff authentication is required.
      </p>
      <Link href="/" className="text-primary underline underline-offset-4 text-sm">
        Return home
      </Link>
    </main>
  )
}
