'use client'

import { AlertCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface ClaimCooldownBannerProps {
  ledgersRemaining: number
  estimatedSecondsRemaining: number
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function ClaimCooldownBanner({ ledgersRemaining, estimatedSecondsRemaining }: ClaimCooldownBannerProps) {
  if (ledgersRemaining <= 0) {
    return null
  }

  const durationStr = formatDuration(estimatedSecondsRemaining)

  return (
    <Card className="border-yellow-200 bg-yellow-50">
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold text-yellow-900">Claim cooldown active</p>
            <p className="text-sm text-yellow-800 mt-1">
              You cannot file a new claim for approximately <strong>{durationStr}</strong> ({ledgersRemaining} ledgers).
            </p>
            <p className="text-xs text-yellow-700 mt-2">
              ⓘ This prevents claim spam and ensures fair governance voting windows. After the cooldown ends, you will be able to file your next claim.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
