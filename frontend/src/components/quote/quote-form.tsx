'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, CheckCircle, Clock, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { generatePremium, QuoteError, getQuoteErrorMessage, QUOTE_TTL_SECONDS } from '@/lib/api/quote'
import { QuoteFormSchema, type QuoteFormData, type QuoteResponse } from '@/lib/schemas/quote'
import { formatTokenAmount } from '@/lib/formatTokenAmount'
import { useWallet } from '@/hooks/use-wallet'

const STEPS = ['Policy Type', 'Region & Age', 'Coverage', 'Result'] as const
type Step = 0 | 1 | 2 | 3

function StepIndicator({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-0 mb-8" aria-label="Quote steps">
      {STEPS.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <span
                className={[
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2',
                  done ? 'bg-blue-600 border-blue-600 text-white' : active ? 'border-blue-600 text-blue-600' : 'border-gray-300 text-gray-400',
                ].join(' ')}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </span>
              <span className={`text-xs hidden sm:block ${active ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${done ? 'bg-blue-600' : 'bg-gray-200'}`} aria-hidden="true" />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="text-sm text-destructive flex items-center gap-1 mt-1" role="alert">
      <AlertCircle className="h-3 w-3 flex-shrink-0" />
      {message}
    </p>
  )
}

function SelectField({
  id, label, error, children, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { id: string; label: string; error?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className={[
          'w-full h-11 rounded-md border bg-background px-3 py-2 text-base ring-offset-background',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          error ? 'border-destructive' : 'border-input',
        ].join(' ')}
        {...props}
      >
        {children}
      </select>
      <FieldError message={error} />
    </div>
  )
}

function NumberField({
  id, label, error, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; error?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="number"
        className={[
          'w-full h-11 rounded-md border bg-background px-3 py-2 text-base ring-offset-background',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          error ? 'border-destructive' : 'border-input',
        ].join(' ')}
        {...props}
      />
      <FieldError message={error} />
    </div>
  )
}

function TtlCountdown({ expiresAt, onExpired }: { expiresAt: number; onExpired: () => void }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()))
  const expiredRef = useRef(false)

  useEffect(() => {
    expiredRef.current = false
    const id = setInterval(() => {
      const r = Math.max(0, expiresAt - Date.now())
      setRemaining(r)
      if (r === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpired()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt, onExpired])

  const secs = Math.floor(remaining / 1000)
  const mins = Math.floor(secs / 60)
  const s = secs % 60
  const urgent = secs < 60

  return (
    <div className={`flex items-center gap-1.5 text-sm ${urgent ? 'text-orange-600' : 'text-muted-foreground'}`}>
      <Clock className="h-4 w-4" />
      <span>
        {remaining === 0 ? 'Quote expired' : `Quote valid for ${mins}:${String(s).padStart(2, '0')}`}
      </span>
    </div>
  )
}

export function QuoteForm() {
  const { toast } = useToast()
  const { address } = useWallet()
  const [step, setStep] = useState<Step>(0)
  const [loading, setLoading] = useState(false)
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [quoteExpiredAt, setQuoteExpiredAt] = useState<number | null>(null)
  const [quoteExpired, setQuoteExpired] = useState(false)

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
    getValues,
    setValue,
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
    },
  })

  // Pre-fill source_account from connected wallet
  useEffect(() => {
    if (address) setValue('source_account', address)
  }, [address, setValue])

  const STEP_FIELDS: (keyof QuoteFormData)[][] = [
    ['policy_type'],
    ['region', 'age'],
    ['coverage_tier', 'risk_score'],
  ]

  async function nextStep() {
    if (step < 2) {
      const valid = await trigger(STEP_FIELDS[step])
      if (valid) setStep((s) => (s + 1) as Step)
    }
  }

  function prevStep() {
    if (step > 0) setStep((s) => (s - 1) as Step)
  }

  async function onSubmit(data: QuoteFormData) {
    setLoading(true)
    setQuote(null)
    setQuoteExpired(false)
    try {
      const result = await generatePremium(data)
      setQuote(result)
      setQuoteExpiredAt(Date.now() + QUOTE_TTL_SECONDS * 1000)
      setStep(3)
    } catch (err) {
      const msg = err instanceof QuoteError ? getQuoteErrorMessage(err) : 'Failed to generate quote'
      toast({ title: 'Quote Error', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  function handleExpired() {
    setQuoteExpired(true)
  }

  function resetForm() {
    setStep(0)
    setQuote(null)
    setQuoteExpiredAt(null)
    setQuoteExpired(false)
  }

  const formData = getValues()

  return (
    <Card className="max-w-xl mx-auto">
      <CardHeader>
        <CardTitle>Get a Quote</CardTitle>
      </CardHeader>
      <CardContent>
        <StepIndicator current={step} />

        {/* ── Step 0: Policy Type ─────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-6">
            <SelectField
              id="policy_type"
              label="Policy Type"
              error={errors.policy_type?.message}
              {...register('policy_type')}
            >
              <option value="">Select a policy type…</option>
              <option value="Auto">Auto</option>
              <option value="Health">Health</option>
              <option value="Property">Property</option>
            </SelectField>
            <div className="flex justify-end">
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* ── Step 1: Region & Age ────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-6">
            <SelectField
              id="region"
              label="Region Risk Tier"
              error={errors.region?.message}
              {...register('region')}
            >
              <option value="">Select a region…</option>
              <option value="Low">Low Risk</option>
              <option value="Medium">Medium Risk</option>
              <option value="High">High Risk</option>
            </SelectField>
            <NumberField
              id="age"
              label="Your Age"
              min={1}
              max={120}
              error={errors.age?.message}
              {...register('age', { valueAsNumber: true })}
            />
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Back</Button>
              <Button type="button" onClick={nextStep}>Next</Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Coverage ────────────────────────────────────── */}
        {step === 2 && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <SelectField
              id="coverage_tier"
              label="Coverage Tier"
              error={errors.coverage_tier?.message}
              {...register('coverage_tier')}
            >
              <option value="">Select a tier…</option>
              <option value="Basic">Basic</option>
              <option value="Standard">Standard</option>
              <option value="Premium">Premium</option>
            </SelectField>
            <NumberField
              id="risk_score"
              label="Risk Score (1–10)"
              min={1}
              max={10}
              error={errors.risk_score?.message}
              {...register('risk_score', { valueAsNumber: true })}
            />
            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={prevStep}>Back</Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Calculating…</>
                ) : (
                  'Get Quote'
                )}
              </Button>
            </div>
          </form>
        )}

        {/* ── Step 3: Result ──────────────────────────────────────── */}
        {step === 3 && quote && (
          <div className="space-y-6">
            {quoteExpired ? (
              <div className="text-center space-y-4 py-4">
                <AlertCircle className="h-10 w-10 text-orange-500 mx-auto" />
                <p className="font-semibold text-gray-900">Quote expired</p>
                <p className="text-sm text-muted-foreground">Premiums may have changed. Please re-simulate.</p>
                <Button onClick={resetForm} variant="outline">Re-simulate</Button>
              </div>
            ) : (
              <>
                {quoteExpiredAt && (
                  <TtlCountdown expiresAt={quoteExpiredAt} onExpired={handleExpired} />
                )}

                <div className="text-center py-2">
                  <p className="text-sm text-muted-foreground mb-1">Annual Premium</p>
                  <p className="text-4xl font-bold text-primary">
                    {formatTokenAmount(quote.premiumXlm, 0)} XLM
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    ({quote.premiumStroops} stroops)
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Policy Type</dt>
                    <dd className="font-medium">{formData.policy_type}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Region</dt>
                    <dd className="font-medium">{formData.region}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Coverage Tier</dt>
                    <dd className="font-medium">{formData.coverage_tier}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Age</dt>
                    <dd className="font-medium">{formData.age}</dd>
                  </div>
                </dl>

                <Badge variant={quote.source === 'simulation' ? 'success' : 'secondary'}>
                  {quote.source === 'simulation' ? 'Live simulation' : 'Local estimate'}
                </Badge>

                <div className="flex flex-col gap-3 pt-2">
                  <Button asChild className="w-full">
                    <Link
                      href={`/policies?quote_type=${formData.policy_type}&quote_region=${formData.region}&quote_tier=${formData.coverage_tier}`}
                    >
                      Proceed to Policy
                    </Link>
                  </Button>
                  <Button variant="outline" className="w-full" onClick={resetForm}>
                    Start Over
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
