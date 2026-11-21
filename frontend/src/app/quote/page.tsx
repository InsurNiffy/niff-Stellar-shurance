import type { Metadata } from 'next'
import { Calculator } from 'lucide-react'
import { QuoteExperience } from '@/components/quote/quote-form'

export const metadata: Metadata = {
  title: 'Get an Insurance Quote',
  description: 'Instantly estimate your Stellar insurance premium. Adjust coverage details and see live pricing.',
}

export default function QuotePage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl" data-tour="get-quote">
      <div className="mb-8 text-center">
        <div className="mb-3 flex items-center justify-center gap-2">
          <Calculator className="h-7 w-7 text-primary" aria-hidden="true" />
          <h1 className="text-3xl font-bold">Get an Insurance Quote</h1>
        </div>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Fill in your coverage details and your estimated premium updates automatically — no submit button needed.
        </p>
      </div>
      <QuoteExperience />
    </div>
  )
}
