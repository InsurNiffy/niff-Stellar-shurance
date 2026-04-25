'use client'

import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  Copy, 
  ExternalLink,
  Wallet,
  Shield
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Stepper, StepContent, type Step } from '@/components/ui/stepper'
import { useToast } from '@/components/ui/use-toast'
import { PolicyAPI, PolicyError, getPolicyErrorMessage, getExplorerUrl } from '@/lib/api/policy'
import { QuoteAPI, QuoteError, getQuoteErrorMessage } from '@/lib/api/quote'
import { PolicyInitiationSchema, PolicyInitiationData, Transaction, Policy } from '@/lib/schemas/policy'
import type { QuoteResponse } from '@/lib/schemas/quote'
import { formatTokenAmount } from '@/lib/formatTokenAmount'


interface PolicyInitiationProps {
  quoteId?: string
}

export function PolicyInitiation({ quoteId: propQuoteId }: PolicyInitiationProps) {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const quoteId = propQuoteId || searchParams.get('quoteId') || ''
  
  const [currentStep, setCurrentStep] = useState(0)
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [transaction, setTransaction] = useState<Transaction | null>(null)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState('')
  const [txStatus, setTxStatus] = useState('')
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    setValue,
  } = useForm<PolicyInitiationData>({
    resolver: zodResolver(PolicyInitiationSchema),
    defaultValues: {
      quoteId,
      walletAddress: '',
      acceptTerms: false,
    }
  })

  const steps: Step[] = [
    {
      id: 'quote',
      title: 'Verify Quote',
      description: 'Review your insurance quote details',
      status: quote ? 'completed' : currentStep === 0 ? 'active' : 'pending'
    },
    {
      id: 'wallet',
      title: 'Connect Wallet',
      description: 'Connect your Stellar wallet',
      status: walletConnected ? 'completed' : currentStep === 1 ? 'active' : quote ? 'pending' : 'pending'
    },
    {
      id: 'transaction',
      title: 'Sign Transaction',
      description: 'Sign the policy transaction',
      status: transaction ? 'completed' : currentStep === 2 ? 'active' : walletConnected ? 'pending' : 'pending'
    },
    {
      id: 'confirmation',
      title: 'Confirmation',
      description: 'Wait for blockchain confirmation',
      status: policy ? 'completed' : currentStep === 3 ? 'active' : transaction ? 'pending' : 'pending'
    }
  ]

  // Move focus to step heading when step changes
  useEffect(() => {
    if (stepHeadingRef.current) {
      stepHeadingRef.current.focus()
    }
  }, [currentStep])

  useEffect(() => {
    if (quoteId) {
      const loadQuote = async () => {
        try {
          const quoteData = await QuoteAPI.getQuoteById(quoteId)
          setQuote(quoteData)
          setCurrentStep(1)
        } catch (error) {
          if (error instanceof QuoteError) {
            toast({
              title: 'Quote Error',
              description: getQuoteErrorMessage(error),
              variant: 'destructive'
            })
          }
        }
      }

      void loadQuote()
    }
  }, [quoteId, toast])

  const connectWallet = async () => {
    try {
      const mockAddress = 'GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
      setWalletAddress(mockAddress)
      setWalletConnected(true)
      setValue('walletAddress', mockAddress)
      setCurrentStep(2)
      setTxStatus('Wallet connected.')
      toast({
        title: 'Wallet Connected',
        description: 'Your Stellar wallet has been connected successfully',
      })
    } catch {
      toast({
        title: 'Connection Error',
        description: 'Failed to connect wallet. Please try again.',
        variant: 'destructive'
      })
    }
  }

  const initiatePolicy = async (data: PolicyInitiationData) => {
    try {
      setIsSubmitting(true)
      setTxStatus('Building policy transaction…')
      const transactionData = await PolicyAPI.initiatePolicy(data)
      setTransaction(transactionData)
      setCurrentStep(3)
      setTxStatus('Waiting for wallet signature…')
      setTimeout(() => {
        submitTransaction(transactionData)
      }, 2000)
    } catch (error) {
      const msg = error instanceof PolicyError ? getPolicyErrorMessage(error) : 'Policy initiation failed.'
      setTxStatus(`Error: ${msg}`)
      if (error instanceof PolicyError) {
        toast({ title: 'Policy Error', description: msg, variant: 'destructive' })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitTransaction = async (transactionData: Transaction) => {
    try {
      setIsPolling(true)
      setTxStatus('Submitting transaction to network…')
      const mockSignature = 'mock-signature'
      const result = await PolicyAPI.submitTransaction(transactionData.transactionXdr, mockSignature)
      setTxStatus('Waiting for blockchain confirmation…')
      const confirmedPolicy = await PolicyAPI.pollPolicyStatus(result.policyId)
      setPolicy(confirmedPolicy)
      setTxStatus(`Policy ${confirmedPolicy.policyId} is now active.`)
      toast({
        title: 'Policy Created!',
        description: `Your policy ${confirmedPolicy.policyId} is now active`,
      })
    } catch (error) {
      const msg = error instanceof PolicyError ? getPolicyErrorMessage(error) : 'Transaction failed.'
      setTxStatus(`Transaction failed: ${msg}`)
      if (error instanceof PolicyError) {
        toast({ title: 'Transaction Error', description: msg, variant: 'destructive' })
      }
    } finally {
      setIsPolling(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast({
      title: 'Copied',
      description: `${label} copied to clipboard`,
    })
  }

  // quote.premium and quote.coverageAmount come from the API as minor-unit strings;
  // decimals are read from the quote response (default 7 for XLM/stroops)
  const tokenDecimals = (quote as QuoteResponse & { decimals?: number })?.decimals ?? 7
  const fmt = (raw: string | number) => formatTokenAmount(String(raw), tokenDecimals)

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <StepContent
            title="Verify Quote"
            description="Please review your insurance quote details"
            isActive={true}
            isCompleted={false}
          >
            {quote ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Premium</Label>
                    <div className="text-2xl font-bold text-primary">
                      {fmt(quote.premium)} XLM
                    </div>
                  </div>
                  <div>
                    <Label>Coverage Amount</Label>
                    <div className="text-2xl font-bold">
                      {fmt(quote.coverageAmount)} XLM
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Terms & Conditions</Label>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {quote.terms.map((term: string, index: number) => (
                      <li key={index} className="flex items-start gap-2">
                        <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                        {term}
                      </li>
                    ))}
                  </ul>
                </div>

                <Button onClick={() => setCurrentStep(1)} className="w-full">
                  Continue to Wallet Connection
                </Button>
              </div>
            ) : (
              <div className="text-center py-8">
                <Skeleton className="h-8 w-3/4 mx-auto mb-4" />
                <Skeleton className="h-4 w-1/2 mx-auto mb-2" />
                <Skeleton className="h-4 w-2/3 mx-auto" />
              </div>
            )}
          </StepContent>
        )

      case 1:
        return (
          <StepContent
            title="Connect Wallet"
            description="Connect your Stellar wallet to proceed"
            isActive={true}
            isCompleted={false}
          >
            <div className="space-y-4">
              <div className="text-center py-8">
                <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground mb-6">
                  Connect your Stellar wallet to create the insurance policy
                </p>
              </div>

              <Button onClick={connectWallet} disabled={walletConnected} className="w-full">
                {walletConnected ? (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Wallet Connected
                  </>
                ) : (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Connect Wallet
                  </>
                )}
              </Button>

              {walletConnected && (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Connected Address:</p>
                  <div className="flex items-center justify-center gap-2 mt-1">
                    <code className="text-xs bg-muted px-2 py-1 rounded">
                      {walletAddress}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(walletAddress, 'Wallet address')}
                      aria-label="Copy wallet address to clipboard"
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </StepContent>
        )

      case 2:
        return (
          <StepContent
            title="Sign Transaction"
            description="Review and sign the policy transaction"
            isActive={true}
            isCompleted={false}
          >
            <div className="space-y-4">
              <form onSubmit={handleSubmit(initiatePolicy)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="walletAddress">Wallet Address</Label>
                  <Input
                    id="walletAddress"
                    placeholder="G..."
                    {...register('walletAddress')}
                    className={errors.walletAddress ? 'border-destructive' : ''}
                    disabled={walletConnected}
                  />
                  {errors.walletAddress && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      {errors.walletAddress.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="acceptTerms"
                      {...register('acceptTerms')}
                      className="rounded border-gray-300 h-5 w-5"
                    />
                    <Label htmlFor="acceptTerms" className="text-sm">
                      I accept the terms and conditions and understand the risks
                    </Label>
                  </div>
                  {errors.acceptTerms && (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      {errors.acceptTerms.message}
                    </p>
                  )}
                </div>

                <div className="bg-muted p-4 rounded-lg">
                  <h4 className="font-semibold mb-2">Transaction Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Premium:</span>
                      <span className="font-semibold">{quote ? fmt(quote.premium) : '0'} XLM</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Network Fee:</span>
                      <span className="font-semibold">0.01 XLM</span>
                    </div>
                    <div className="flex justify-between border-t pt-2">
                      <span>Total:</span>
                      <span className="font-semibold">{quote ? fmt(quote.premium + 0.01) : '0.01'} XLM</span>
                    </div>
                  </div>
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
                        Initiating Policy...
                      </>
                    ) : (
                      'Initiate Policy'
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </StepContent>
        )

      case 3:
        return (
          <StepContent
            title="Confirmation"
            description="Waiting for blockchain confirmation"
            isActive={true}
            isCompleted={false}
            hasError={!policy && !isPolling}
          >
            <div className="space-y-4">
              {isPolling ? (
                <div className="text-center py-8">
                  <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-primary" />
                  <p className="text-muted-foreground">Confirming transaction on blockchain...</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    This usually takes 5-10 seconds
                  </p>
                </div>
              ) : policy ? (
                <div className="space-y-4">
                  <div className="text-center">
                    <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-500" />
                    <h3 className="text-xl font-semibold text-green-600 mb-2">
                      Policy Created Successfully!
                    </h3>
                    <p className="text-muted-foreground">
                      Your insurance policy is now active
                    </p>
                  </div>

                  <div className="bg-muted p-4 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Policy ID:</span>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-background px-2 py-1 rounded">
                          {policy.policyId}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(policy.policyId, 'Policy ID')}
                          aria-label="Copy policy ID to clipboard"
                        >
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Status:</span>
                      <Badge variant="success">Active</Badge>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Coverage:</span>
                      <span className="font-semibold">{fmt(policy.coverageAmount)} XLM</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Expires:</span>
                      <span className="text-sm">
                        {new Date(policy.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {policy.transactionHash && (
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" asChild>
                        <a
                          href={getExplorerUrl(policy.transactionHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View transaction on Stellar Explorer (opens in new tab)"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                          View Transaction
                        </a>
                      </Button>
                      <Button className="flex-1" asChild>
                        <a href="/dashboard">
                          View Dashboard
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
                  <p className="text-destructive font-semibold mb-2">
                    Transaction Failed
                  </p>
                  <p className="text-muted-foreground mb-4">
                    The transaction could not be confirmed. Please try again.
                  </p>
                  <Button onClick={() => setCurrentStep(2)} variant="outline">
                    Try Again
                  </Button>
                </div>
              )}
            </div>
          </StepContent>
        )

      default:
        return null
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Live region for tx status updates */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {txStatus}
      </div>

      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-4">
          <Shield className="h-8 w-8 text-blue-600 mr-2" aria-hidden="true" />
          <h1 className="text-3xl font-bold text-gray-900">Create Insurance Policy</h1>
        </div>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Follow the steps below to create your parametric insurance policy.
        </p>
      </div>

      <div className="max-w-4xl mx-auto">
        <Stepper steps={steps} currentStep={currentStep} aria-label="Policy creation steps" className="mb-8" />

        {/* Visually hidden heading receives focus on step change */}
        <h2
          ref={stepHeadingRef}
          tabIndex={-1}
          className="sr-only focus:not-sr-only focus:outline-none"
        >
          Step {currentStep + 1} of {steps.length}: {steps[currentStep]?.title}
        </h2>

        <Card>
          <CardContent className="p-6">
            {renderStepContent()}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
