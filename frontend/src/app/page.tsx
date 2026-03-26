import dynamic from 'next/dynamic'
import { Hero } from '@/components/landing/hero'
import { Skeleton } from '@/components/ui/skeleton'

const HowItWorks = dynamic(
  () => import('@/components/landing/how-it-works').then((m) => m.HowItWorks),
  { loading: () => <Skeleton className="h-96 w-full" /> }
)

const Security = dynamic(
  () => import('@/components/landing/security').then((m) => m.Security),
  { loading: () => <Skeleton className="h-96 w-full" /> }
)

const CTA = dynamic(
  () => import('@/components/landing/cta').then((m) => m.CTA),
  { loading: () => <Skeleton className="h-64 w-full" /> }
)

export default function Home() {
  return (
    <main>
      <Hero />
      <HowItWorks />
      <Security />
      <CTA />
    </main>
  )
}
