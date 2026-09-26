'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { Label } from '@/components/ui/label'
import { QuoteFormSchema, type QuoteFormData } from '@/lib/schemas/quote'
import { useWallet } from '@/features/wallet'
import { PolicyTypeSelector } from '@/components/policy/PolicyTypeSelector'

interface Props {
  onChange: (data: Partial<QuoteFormData>, isValid: boolean) => void
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1 flex items-center gap-1 text-sm text-destructive" role="alert">
      <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}

const selectClass = (err?: string) =>
  `w-full h-11 rounded-md border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${err ? 'border-destructive' : 'border-input'}`

export function QuoteForm({ onChange }: Props) {
  const { address } = useWallet()

  const {
    register,
    watch,
    setValue,
    formState: { errors, isValid },
  } = useForm<QuoteFormData>({
    resolver: zodResolver(QuoteFormSchema),
    mode: 'onChange',
    defaultValues: { risk_score: 5, source_account: '' },
  })

  useEffect(() => {
    if (address) setValue('source_account', address, { shouldValidate: true })
  }, [address, setValue])

  const values = watch()
  useEffect(() => {
    onChange(values, isValid)
  }, [JSON.stringify(values), isValid]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form aria-label="Insurance quote form" noValidate className="space-y-5">
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
        <select id="region" className={selectClass(errors.region?.message)} {...register('region')}>
          <option value="">Select a region…</option>
          <option value="Low">Low Risk</option>
          <option value="Medium">Medium Risk</option>
          <option value="High">High Risk</option>
        </select>
        <FieldError message={errors.region?.message} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="coverage_tier">Coverage Tier</Label>
        <select id="coverage_tier" className={selectClass(errors.coverage_tier?.message)} {...register('coverage_tier')}>
          <option value="">Select a tier…</option>
          <option value="Basic">Basic</option>
          <option value="Standard">Standard</option>
          <option value="Premium">Premium</option>
        </select>
        <FieldError message={errors.coverage_tier?.message} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="age">Age</Label>
          <input
            id="age"
            type="number"
            min={1}
            max={120}
            className={selectClass(errors.age?.message)}
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
            className={selectClass(errors.risk_score?.message)}
            {...register('risk_score', { valueAsNumber: true })}
          />
          <FieldError message={errors.risk_score?.message} />
        </div>
      </div>
    </form>
  )
}
