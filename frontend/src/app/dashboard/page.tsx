import Link from 'next/link'

import { ProtocolStatsWidget } from '@/components/dashboard/ProtocolStatsWidget'
import { DraggableDashboardCards, type DashboardCardDef } from '@/components/dashboard/DraggableDashboardCards'
import { Button } from '@/components/ui/button'

const DASHBOARD_CARDS: DashboardCardDef[] = [
  {
    id: 'protocol-stats',
    label: 'Protocol Stats',
    content: <ProtocolStatsWidget />,
  },
  {
    id: 'quick-actions',
    label: 'Quick Actions',
    content: (
      <div className="rounded-lg border p-4 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/policies">My Policies</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/claims">My Claims</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/quote">Get a Quote</Link>
        </Button>
      </div>
    ),
  },
]

export default function DashboardPage() {
  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Protocol-level metrics refresh automatically every 30 seconds. Drag a card by its
            handle to reorder — your layout is saved automatically.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/policies">My Policies</Link>
        </Button>
      </div>

      <DraggableDashboardCards cards={DASHBOARD_CARDS} />
    </main>
  )
}
