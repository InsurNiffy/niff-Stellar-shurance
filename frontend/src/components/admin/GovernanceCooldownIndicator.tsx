'use client'

import { AlertCircle, Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface GovernanceCooldownIndicatorProps {
  currentLedger: number
  expiryLedger: number
  proposedAction?: string
}

function ledgersToMinutes(ledgers: number): number {
  return Math.ceil(ledgers * 5 / 60)
}

export function GovernanceCooldownIndicator({
  currentLedger,
  expiryLedger,
  proposedAction = 'Parameter change'
}: GovernanceCooldownIndicatorProps) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiryLedger - currentLedger))

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(prev => Math.max(0, prev - 1))
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  if (remaining <= 0) return null

  const remainingMinutes = ledgersToMinutes(remaining)

  return (
    <Card className="border-orange-200 bg-orange-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-orange-900">
          <Clock className="h-5 w-5" aria-hidden="true" />
          Governance Cooldown Active
        </CardTitle>
        <CardDescription className="text-orange-800">
          Parameter changes are temporarily restricted due to an active cooldown period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm text-orange-900">
            <strong>Pending action:</strong> {proposedAction}
          </p>
          <div className="flex items-baseline gap-2">
            <p className="text-sm text-orange-900">Time remaining:</p>
            <p className="text-2xl font-bold text-orange-700 tabular-nums">
              {remainingMinutes} minute{remainingMinutes !== 1 ? 's' : ''}
            </p>
          </div>
          <p className="text-xs text-orange-800">
            Ledger countdown: {remaining} ledger{remaining !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-md bg-orange-100 p-3">
          <AlertCircle className="h-4 w-4 text-orange-700 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-orange-900">
            Parameter updates cannot be proposed while a cooldown is active. Please wait for the cooldown to expire before submitting new governance proposals.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
