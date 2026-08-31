'use client'

import { useEffect, useState } from 'react'
import { Car, Heart, Home, Shield } from 'lucide-react'
import { fetchPolicyTypes, type PolicyTypeOption } from '@/lib/api/policy-types'
import { cn } from '@/lib/utils'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Auto: Car,
  Health: Heart,
  Property: Home,
}

interface PolicyTypeSelectorProps {
  value: string | undefined
  onChange: (value: string) => void
  error?: string
}

export function PolicyTypeSelector({ value, onChange, error }: PolicyTypeSelectorProps) {
  const [options, setOptions] = useState<PolicyTypeOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetchPolicyTypes(controller.signal)
      .then(setOptions)
      .catch(() => {
        setOptions([
          { id: 'Auto', label: 'Auto', description: 'Vehicle and automotive coverage' },
          { id: 'Health', label: 'Health', description: 'Health and medical coverage' },
          { id: 'Property', label: 'Property', description: 'Property and real estate coverage' },
        ])
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        role="radiogroup"
        aria-label="Policy type"
      >
        {options.map((option) => {
          const Icon = ICON_MAP[option.id] ?? Shield
          const selected = value === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.id)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-center transition-colors',
                selected
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-input hover:border-primary/50 hover:bg-muted/50',
                error && !value && 'border-destructive',
              )}
            >
              <Icon className={cn('h-8 w-8', selected ? 'text-primary' : 'text-muted-foreground')} />
              <span className="text-sm font-medium">{option.label}</span>
              {option.description && (
                <span className="text-xs text-muted-foreground">{option.description}</span>
              )}
            </button>
          )
        })}
      </div>
      {error && (
        <p className="mt-1 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
