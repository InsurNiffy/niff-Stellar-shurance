'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { QuoteFormSchema, type QuoteFormData } from '@/lib/schemas/quote'
import { useWallet } from '@/features/wallet'
import { RegionCombobox } from '@/components/ui/region-combobox'
import { PolicyTypeSelector } from '@/components/policy/PolicyTypeSelector'

interface Props {
  defaultValues: Partial<QuoteFormData>
  onNext: (data: QuoteFormData) => void
  onChange: (data: Partial<QuoteFormData>) => void
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="text-sm text-destructive flex items-center gap-1 mt-1" role="alert">
      <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

export function CoverageDetailsStep({ defaultValues, onNext, onChange }: Props) {
  const { address } = useWallet()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<QuoteFormData>({
    resolver: zodResolver(QuoteFormSchema),
    mode: 'onTouched',
    defaultValues: {
      policy_type: undefined,
      region: undefined,
      coverage_tier: undefined,
      age: undefined,
      risk_score: 5,
      source_account: '',
      ...defaultValues,
    },
  })

  // Pre-fill wallet address
  useEffect(() => {
    if (address && !defaultValues.source_account) {
      setValue('source_account', address)
    }
  }, [address, defaultValues.source_account, setValue])

  // Persist draft on field changes (subscribe — avoid depending on `watch()` object identity)
  useEffect(() => {
    const subscription = watch((data) => {
      onChange(data)
    })
    return () => subscription.unsubscribe()
  }, [watch, onChange])

  return (
    <form
      onSubmit={handleSubmit(onNext)}
      className="space-y-5"
      aria-label="Coverage details"
      noValidate
    >
      <div className="space-y-1">
        <Label>Policy Type</Label>
        <PolicyTypeSelector
          value={watch('policy_type')}
          onChange={(val) => setValue('policy_type', val as QuoteFormData['policy_type'], { shouldValidate: true })}
          error={errors.policy_type?.message}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="region">Region Risk Tier</Label>
        <RegionCombobox
          value={watch('region')}
          onChange={(val) => setValue('region', val as QuoteFormData['region'], { shouldValidate: true })}
          error={errors.region?.message}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="coverage_tier">Coverage Tier</Label>
        <select
          id="coverage_tier"
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.coverage_tier ? 'border-destructive' : 'border-input'}`}
          {...register('coverage_tier')}
        >
          <option value="">Select a tier…</option>
          <option value="Basic">Basic</option>
          <option value="Standard">Standard</option>
          <option value="Premium">Premium</option>
        </select>
        <FieldError message={errors.coverage_tier?.message} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="age">Your Age</Label>
        <input
          id="age"
          type="number"
          min={1}
          max={120}
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.age ? 'border-destructive' : 'border-input'}`}
          {...register('age', { valueAsNumber: true })}
        />
        <FieldError message={errors.age?.message} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="risk_score">Risk Score (1–10)</Label>
        <input
          id="risk_score"
          type="number"
          min={1}
          max={10}
          className={`w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.risk_score ? 'border-destructive' : 'border-input'}`}
          {...register('risk_score', { valueAsNumber: true })}
        />
        <FieldError message={errors.risk_score?.message} />
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit">Get Quote</Button>
      </div>
    </form>
  )
}
