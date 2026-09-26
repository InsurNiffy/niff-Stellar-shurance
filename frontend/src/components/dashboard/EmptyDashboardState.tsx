import Link from 'next/link'

import { Button } from '@/components/ui/button'

interface NextStep {
  href: string
  label: string
  description: string
}

const NEXT_STEPS: NextStep[] = [
  {
    href: '/quote',
    label: 'Get a quote',
    description: 'Answer a few questions to see coverage options and pricing for your assets.',
  },
  {
    href: '/docs',
    label: 'Learn how coverage works',
    description: 'Understand how policies, premiums, and claims work on-chain.',
  },
  {
    href: '/purchase',
    label: 'Browse policy types',
    description: 'Explore the kinds of coverage available before you buy.',
  },
]

/**
 * First-run empty state shown when a connected wallet has zero policies
 * and zero claims. Replaces the normal populated dashboard widgets with
 * onboarding guidance and CTAs so a new user isn't left looking at empty
 * widgets with no indication of what to do next.
 */
export function EmptyDashboardState() {
  return (
    <div
      data-testid="empty-dashboard-state"
      className="flex flex-col items-center gap-6 rounded-lg border border-dashed border-gray-300 px-6 py-16 text-center"
    >
      <span className="text-5xl" aria-hidden="true">
        🛡️
      </span>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">Welcome — let&apos;s get you covered</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          You don&apos;t have any policies or claims yet. Here&apos;s how to get started.
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-3">
        {NEXT_STEPS.map((step) => (
          <div
            key={step.href}
            className="flex flex-col items-center gap-2 rounded-md border border-gray-200 p-4 text-center"
          >
            <p className="text-sm text-muted-foreground">{step.description}</p>
            <Button asChild size="sm" variant={step.href === '/quote' ? 'default' : 'outline'}>
              <Link href={step.href}>{step.label}</Link>
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
