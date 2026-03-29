export const metadata = { title: 'Admin' }

/**
 * Placeholder admin segment so `error.tsx` can scope failures without affecting
 * the rest of the app. Extend with real admin UI when available.
 */
export default function AdminPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-2xl font-semibold text-gray-900 mb-2">Admin</h1>
      <p className="text-sm text-muted-foreground">Administrative tools will appear here.</p>
    </main>
  )
}
