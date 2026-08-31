'use client'

import { Badge } from '@/components/ui/badge'

const FRAUD_LOW_THRESHOLD = 40
const FRAUD_HIGH_THRESHOLD = 70

interface FraudScoreBadgeProps {
  score: number
}

function getFraudLevel(score: number) {
  if (score >= FRAUD_HIGH_THRESHOLD) return 'high' as const
  if (score >= FRAUD_LOW_THRESHOLD) return 'medium' as const
  return 'low' as const
}

function getFraudVariant(level: 'low' | 'medium' | 'high') {
  switch (level) {
    case 'high':
      return 'destructive'
    case 'medium':
      return 'warning'
    case 'low':
      return 'success'
  }
}

const FRAUD_LABELS = {
  low: 'Low Risk',
  medium: 'Medium Risk',
  high: 'High Risk',
} as const

export function FraudScoreBadge({ score }: FraudScoreBadgeProps) {
  const level = getFraudLevel(score)
  const variant = getFraudVariant(level)
  const label = FRAUD_LABELS[level]

  return (
    <Badge
      variant={variant}
      title="Fraud risk score assessed by on-chain oracle"
      aria-label={`Fraud score: ${score}% — ${label}`}
    >
      Fraud {score}% — {label}
    </Badge>
  )
}
