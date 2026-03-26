import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

const PolicyInitiation = dynamic(
  () => import('@/components/policy/policy-initiation').then((m) => m.PolicyInitiation),
  {
    loading: () => (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Skeleton className="h-10 w-64 mx-auto mb-4" />
        <Skeleton className="h-5 w-96 mx-auto mb-8" />
        <Skeleton className="h-16 w-full mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    ),
    ssr: false,
  }
)

export default function PolicyPage() {
  return <PolicyInitiation />
}
