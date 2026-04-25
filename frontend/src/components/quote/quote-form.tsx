'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, AlertCircle, CheckCircle, Clock } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumericInput } from '@/components/ui/numeric-input'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { QuoteAPI, QuoteError, getQuoteErrorMessage } from '@/lib/api/quote'
import { QuoteFormSchema, QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'
import { formatTokenAmount } from '@/lib/formatTokenAmount'


interface QuoteFormProps {
  onQuoteReceived?: (quote: QuoteResponse) => void
}

export function QuoteForm({ onQuoteReceived }: QuoteFormProps) {
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [currentQuote, setCurrentQuote] = useState<QuoteResponse | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState('')
  
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isValid, isDirty }
  } = useForm<QuoteFormData>({
    resolver: zodResolver(QuoteFormSchema),
    mode: 'onChange',
    defaultValues: {
      coverageAmount: 1000,
      duration: 30,
      riskCategory: 'MEDIUM',
      contractType: 'DEFI_PROTOCOL',
      additionalCoverage: false,
    }
  })

  const watchedValues = watch()

  // Watch for form changes and trigger debounced calculation
  useEffect(() => {
    if (!isValid || !isDirty) {
      setIsCalculating(false)
      return
    }

    // Fire quote_started once per form session (first dirty + valid state)
    if (!hasTrackedStart) {
      setHasTrackedStart(true)
      trackQuoteStarted({
        riskCategory: watchedValues.riskCategory ?? 'MEDIUM',
        contractType: watchedValues.contractType ?? 'DEFI_PROTOCOL',
      })
    }

    const timeout = setTimeout(async () => {
      try {
        setIsCalculating(true)
        const quote = await QuoteAPI.getQuote(watchedValues)
        setCurrentQuote(quote)
        setQuoteStatus(`Quote updated: premium ${quote.premium} XLM for ${quote.coverageAmount} XLM coverage.`)
      } catch (error) {
        if (error instanceof QuoteError && error.code !== 'VALIDATION_ERROR') {
          toast({
            title: 'Calculation Error',
            description: getQuoteErrorMessage(error),
            variant: 'destructive'
          })
        }
        setCurrentQuote(null)
        setQuoteStatus('')
      } finally {
        setIsCalculating(false)
      }
    }, 800)

    return () => clearTimeout(timeout)
  }, [watchedValues, isValid, isDirty, toast, hasTrackedStart])

  const onSubmit = async (data: QuoteFormData) => {
    try {
      setIsSubmitting(true)
      const quote = await QuoteAPI.getQuote(data)
      setCurrentQuote(quote)
      setQuoteStatus(`Quote confirmed: premium ${quote.premium} XLM.`)
      onQuoteReceived?.(quote)
      trackQuoteReceived({
        riskCategory: data.riskCategory,
        contractType: data.contractType,
      })
      
      toast({
        title: 'Quote Generated',
        description: `Your premium is ${quote.premium} XLM for ${quote.coverageAmount} XLM coverage`,
      })
    } catch (error) {
      if (error instanceof QuoteError) {
        toast({
          title: 'Quote Error',
          description: getQuoteErrorMessage(error),
          variant: 'destructive'
        })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // Read decimals from quote response; fall back to 7 (XLM/stroops)
  const tokenDecimals = (currentQuote as QuoteResponse & { decimals?: number })?.decimals ?? 7
  const fmt = (raw: string | number) => formatTokenAmount(String(raw), tokenDecimals)

  const getTimeUntilExpiry = (expiresAt: string) => {
    const expiry = new Date(expiresAt)
    const now = new Date()
    const diff = expiry.getTime() - now.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    if (diff <= 0) return 'Expired'
    return `${hours}h ${minutes}m`
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 min-w-0">
      {/* Live region announces quote updates to screen readers */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {isCalculating ? 'Calculating quote…' : quoteStatus}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Get Insurance Quote</CardTitle>
          <CardDescription>
            Fill in the details below to receive a personalized insurance quote for your smart contract.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="contractAddress">Contract Address</Label>
              <Input
                id="contractAddress"
                placeholder="G..."
                {...register('contractAddress')}
                className={errors.contractAddress ? 'border-destructive' : ''}
              />
              {errors.contractAddress && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  {errors.contractAddress.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="coverageAmount">Coverage Amount (XLM)</Label>
                <Controller
                  name="coverageAmount"
                  control={control}
                  render={({ field }) => (
                    <NumericInput
                      id="coverageAmount"
                      decimals={2}
                      prefix="XLM "
                      error={errors.coverageAmount?.message}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="duration">Duration (days)</Label>
                <Controller
                  name="duration"
                  control={control}
                  render={({ field }) => (
                    <NumericInput
                      id="duration"
                      decimals={0}
                      suffix=" days"
                      error={errors.duration?.message}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="riskCategory">Risk Category</Label>
                <select
                  id="riskCategory"
                  {...register('riskCategory')}
                  className={`w-full h-11 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    errors.riskCategory ? 'border-destructive' : ''
                  }`}
                >
                  <option value="LOW">Low Risk</option>
                  <option value="MEDIUM">Medium Risk</option>
                  <option value="HIGH">High Risk</option>
                </select>
                {errors.riskCategory && (
                  <p className="text-sm text-destructive">{errors.riskCategory.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="contractType">Contract Type</Label>
                <select
                  id="contractType"
                  {...register('contractType')}
                  className={`w-full h-11 rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                    errors.contractType ? 'border-destructive' : ''
                  }`}
                >
                  <option value="DEFI_PROTOCOL">DeFi Protocol</option>
                  <option value="SMART_CONTRACT">Smart Contract</option>
                  <option value="LIQUIDITY_POOL">Liquidity Pool</option>
                  <option value="BRIDGE">Bridge</option>
                </select>
                {errors.contractType && (
                  <p className="text-sm text-destructive">{errors.contractType.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <textarea
                id="description"
                rows={3}
                placeholder="Describe your contract and what it does..."
                {...register('description')}
                className={`w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  errors.description ? 'border-destructive' : ''
                }`}
              />
              {errors.description && (
                <p className="text-sm text-destructive">{errors.description.message}</p>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="additionalCoverage"
                {...register('additionalCoverage')}
                className="rounded border-gray-300 h-5 w-5"
              />
              <Label htmlFor="additionalCoverage" className="text-sm">
                Include additional coverage options
              </Label>
            </div>

            {/* Sticky CTA on mobile */}
            <div className="sticky-action-bar bg-background/95 backdrop-blur-sm border-t pt-3 -mx-6 px-6 sm:static sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:pt-0 sm:mx-0 sm:px-0">
              <Button
                type="submit"
                disabled={!isValid || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating Quote...
                  </>
                ) : (
                  'Get Quote'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quote Preview</CardTitle>
          <CardDescription>
            Your quote will appear here as you fill out the form.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isCalculating ? (
            <div className="space-y-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <div className="pt-4">
                <Skeleton className="h-12 w-full" />
              </div>
            </div>
          ) : currentQuote ? (
            <div className="space-y-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">
                  {fmt(currentQuote.premium)} XLM
                </div>
                <p className="text-sm text-muted-foreground">Premium</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Coverage Amount</p>
                  <p className="font-semibold">{fmt(currentQuote.coverageAmount)} XLM</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Risk Score</p>
                  <p className="font-semibold">{currentQuote.riskScore}/100</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-orange-500" />
                <span className="text-sm text-muted-foreground">
                  Expires in {getTimeUntilExpiry(currentQuote.expiresAt)}
                </span>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Terms & Conditions</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {currentQuote.terms.slice(0, 3).map((term, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                      {term}
                    </li>
                  ))}
                </ul>
              </div>

              <Badge variant={currentQuote.riskScore < 50 ? 'success' : currentQuote.riskScore < 75 ? 'warning' : 'destructive'}>
                {currentQuote.riskScore < 50 ? 'Low Risk' : currentQuote.riskScore < 75 ? 'Medium Risk' : 'High Risk'}
              </Badge>

              <Button className="w-full" asChild>
                <a href={`/policy?quoteId=${currentQuote.quoteId}`} onClick={() => trackBindStarted()}>
                  Purchase Policy
                </a>
              </Button>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Fill in the form to see your quote preview</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
