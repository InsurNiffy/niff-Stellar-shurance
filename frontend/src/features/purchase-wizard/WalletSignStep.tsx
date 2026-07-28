'use client'

import { AlertCircle, CheckCircle, DollarSign, Loader2, RefreshCw, Wallet } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StellarExplorerLink } from '@/components/ui/StellarExplorerLink'
import { useWallet } from '@/features/wallet'
import { WalletConnectButton } from '@/features/wallet'
import { useTransactionStatus } from '@/hooks/useTransactionStatus'
import { getConfig } from '@/config/env'
import {
  initiatePolicy,
  submitSignedPolicy,
  checkAllowance,
  buildApprovalTransaction,
  submitApprovalTransaction,
  type AllowanceCheckResponse,
} from './api'
import type { QuoteFormData, QuoteResponse } from '@/lib/schemas/quote'
import type { SubmitPhase, SubmitState } from './types'
import { AppError } from '@/lib/errors'

interface Props {
  coverageData: QuoteFormData
  quote: QuoteResponse
  quoteExpiresAt: number
  onBack: () => void
  onSuccess: () => void
}

const PHASE_LABELS: Record<SubmitPhase, string> = {
  idle: '',
  allowance_checking: 'Checking token allowance…',
  approval_needed: '',
  approval_signing: 'Waiting for wallet approval signature…',
  approval_submitting: 'Submitting approval to network…',
  approval_polling: 'Confirming approval on-chain…',
  initiating: 'Preparing transaction…',
  signing: 'Waiting for wallet signature…',
  submitting: 'Submitting to network…',
  polling: 'Confirming on-chain…',
  success: 'Policy created!',
  error: '',
}

function PhaseStatus({ phase }: { phase: SubmitPhase }) {
  if (phase === 'idle' || phase === 'error' || phase === 'approval_needed') return null
  if (phase === 'success') {
    return (
      <div className="flex items-center gap-2 text-green-600" role="status">
        <CheckCircle className="h-5 w-5" aria-hidden="true" />
        <span className="font-medium">{PHASE_LABELS.success}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span>{PHASE_LABELS[phase]}</span>
    </div>
  )
}

/**
 * Wallet sign requests can fail because the user rejected them or because
 * they timed out waiting for a response — both leave the user stuck without
 * a clear next action unless we surface a specific, actionable message.
 */
function describeSignError(err: unknown, action: 'transaction' | 'approval'): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  const retryLabel = action === 'transaction' ? '"Sign & Submit"' : '"Approve Spending"'

  if (lower.includes('reject') || lower.includes('cancel')) {
    return `You rejected the ${action} in your wallet. Click ${retryLabel} to try again.`
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return `The signature request timed out. Click ${retryLabel} to try again.`
  }
  return `Signing failed: ${msg}`
}

function formatStroopsToXLM(stroops: string): string {
  const num = BigInt(stroops)
  const xlm = Number(num) / 10_000_000
  return xlm.toFixed(7)
}

function AllowanceWarning({ allowance, premium }: { allowance: AllowanceCheckResponse; premium: string }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3" role="alert">
      <div className="flex items-start gap-2">
        <DollarSign className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-sm text-amber-900">Token spending approval required</p>
          <p className="text-sm text-amber-700">
            The policy contract does not have sufficient spending allowance for your tokens.
          </p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-amber-600">Current Allowance</dt>
              <dd className="font-mono text-xs">{formatStroopsToXLM(allowance.currentAllowance)} XLM</dd>
            </div>
            <div>
              <dt className="text-xs text-amber-600">Required</dt>
              <dd className="font-mono text-xs">{formatStroopsToXLM(premium)} XLM</dd>
            </div>
            <div>
              <dt className="text-xs text-amber-600">Contract</dt>
              <dd className="font-mono text-xs truncate" title={allowance.contractAddress}>{allowance.contractAddress.slice(0, 12)}...{allowance.contractAddress.slice(-4)}</dd>
            </div>
            <div>
              <dt className="text-xs text-amber-600">Token</dt>
              <dd className="font-mono text-xs truncate" title={allowance.tokenAddress}>{allowance.tokenAddress.slice(0, 12)}...{allowance.tokenAddress.slice(-4)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}

export function WalletSignStep({ coverageData, quote, quoteExpiresAt, onBack, onSuccess }: Props) {
  const router = useRouter()
  const { address, connectionStatus, signTransaction } = useWallet()
  const { contractId } = getConfig()
  const [state, setState] = useState<SubmitState>({
    phase: 'idle',
    txHash: null,
    policyId: null,
    error: null,
  })
  const [allowanceInfo, setAllowanceInfo] = useState<AllowanceCheckResponse | null>(null)
  const [approvalTxHash, setApprovalTxHash] = useState<string | null>(null)
  const submittedRef = useRef(false)

  const txStatus = useTransactionStatus(
    state.phase === 'polling' ? state.txHash : null,
  )

  const approvalTxStatus = useTransactionStatus(
    state.phase === 'approval_polling' ? approvalTxHash : null,
  )

  // Handle polling terminal states for the main policy transaction
  useEffect(() => {
    if (state.phase !== 'polling') return
    if (txStatus.status === 'SUCCESS' && state.policyId) {
      setState((s) => ({ ...s, phase: 'success' }))
      onSuccess()
      router.push(`/policies/${state.policyId}`)
    } else if (txStatus.status === 'FAILED' || txStatus.status === 'NOT_FOUND_TIMEOUT') {
      setState((s) => ({
        ...s,
        phase: 'error',
        error: txStatus.status === 'FAILED'
          ? 'Transaction failed on-chain. Please try again.'
          : 'Transaction not confirmed in time. Check your wallet or try again.',
      }))
    }
  }, [txStatus.status, state.phase, state.policyId, onSuccess, router])

  // Handle polling terminal states for the approval transaction
  useEffect(() => {
    if (state.phase !== 'approval_polling') return
    if (approvalTxStatus.status === 'SUCCESS') {
      // Approval confirmed — proceed to initiate the policy
      setState((s) => ({ ...s, phase: 'initiating' }))
      performPolicyInitiation()
    } else if (approvalTxStatus.status === 'FAILED' || approvalTxStatus.status === 'NOT_FOUND_TIMEOUT') {
      setState((s) => ({
        ...s,
        phase: 'error',
        error: approvalTxStatus.status === 'FAILED'
          ? 'Token approval failed on-chain. Please try again.'
          : 'Token approval not confirmed in time. Check your wallet or try again.',
      }))
      submittedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalTxStatus.status, state.phase])

  const isQuoteExpired = quoteExpiresAt < Date.now()

  // Extract the premium amount in stroops from the quote
  const premiumStroops = (() => {
    if (!quote.premiumXlm) return null
    try {
      const xlm = Number(quote.premiumXlm)
      const stroops = BigInt(Math.round(xlm * 10_000_000))
      return stroops.toString()
    } catch {
      return null
    }
  })()

  // Called after allowance is confirmed or after approval completes
  const performPolicyInitiation = useCallback(async () => {
    if (!address) return
    try {
      setState((s) => ({ ...s, phase: 'initiating' }))
      const { transactionXdr, quoteId } = await initiatePolicy({
        ...coverageData,
        walletAddress: address,
      })

      setState((s) => ({ ...s, phase: 'signing' }))
      let signedXdr: string
      try {
        signedXdr = await signTransaction(transactionXdr)
      } catch (err) {
        setState({
          phase: 'error',
          txHash: null,
          policyId: null,
          error: describeSignError(err, 'transaction'),
        })
        submittedRef.current = false
        return
      }

      setState((s) => ({ ...s, phase: 'submitting' }))
      const { policyId, txHash } = await submitSignedPolicy(transactionXdr, signedXdr, quoteId)

      setState({ phase: 'polling', txHash, policyId, error: null })
    } catch (err) {
      const msg = err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'An unexpected error occurred'
      setState({ phase: 'error', txHash: null, policyId: null, error: msg })
      submittedRef.current = false
    }
  }, [address, coverageData, signTransaction])

  const handleSubmit = useCallback(async () => {
    if (submittedRef.current) return
    if (!address) return
    if (isQuoteExpired) {
      setState((s) => ({ ...s, phase: 'error', error: 'Quote has expired. Please go back and regenerate.' }))
      return
    }

    submittedRef.current = true
    setState({ phase: 'allowance_checking', txHash: null, policyId: null, error: null })

    try {
      if (!premiumStroops) {
        throw new AppError('PREMIUM_PARSE_ERROR', 'Could not determine premium amount for allowance check.')
      }

      const allowance = await checkAllowance(address, contractId, premiumStroops)
      setAllowanceInfo(allowance)

      if (allowance.sufficient) {
        await performPolicyInitiation()
      } else {
        setState({ phase: 'approval_needed', txHash: null, policyId: null, error: null })
      }
    } catch (err) {
      console.warn('Allowance check failed, proceeding without pre-flight:', err)
      await performPolicyInitiation()
    }
  }, [address, isQuoteExpired, premiumStroops, contractId, performPolicyInitiation])

  const handleApproveSpending = useCallback(async () => {
    if (!address || !allowanceInfo) return
    if (!premiumStroops) return

    setState((s) => ({ ...s, phase: 'approval_signing' }))

    try {
      const { transactionXdr, quoteId } = await buildApprovalTransaction(
        address,
        allowanceInfo.contractAddress,
        premiumStroops,
      )

      let signedXdr: string
      try {
        signedXdr = await signTransaction(transactionXdr)
      } catch (err) {
        setState({
          phase: 'error',
          txHash: null,
          policyId: null,
          error: describeSignError(err, 'approval'),
        })
        submittedRef.current = false
        return
      }

      setState((s) => ({ ...s, phase: 'approval_submitting' }))
      const { txHash } = await submitApprovalTransaction(transactionXdr, signedXdr, quoteId)
      setApprovalTxHash(txHash)

      setState({ phase: 'approval_polling', txHash, policyId: null, error: null })
    } catch (err) {
      const msg = err instanceof AppError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'An unexpected error occurred'
      setState({ phase: 'error', txHash: null, policyId: null, error: msg })
      submittedRef.current = false
    }
  }, [address, allowanceInfo, premiumStroops, signTransaction])

  const handleRetry = () => {
    submittedRef.current = false
    setApprovalTxHash(null)
    setAllowanceInfo(null)
    setState({ phase: 'idle', txHash: null, policyId: null, error: null })
  }

  const isSubmitting = [
    'allowance_checking',
    'approval_signing',
    'approval_submitting',
    'approval_polling',
    'initiating',
    'signing',
    'submitting',
    'polling',
  ].includes(state.phase)

  if (connectionStatus !== 'connected') {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6 space-y-4 text-center">
            <Wallet className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Connect your wallet to sign and submit</p>
            <p className="text-sm text-muted-foreground">
              You need a connected Stellar wallet to purchase this policy.
            </p>
            <WalletConnectButton />
          </CardContent>
        </Card>
        <Button variant="outline" onClick={onBack}>Back</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Premium</dt>
              <dd className="font-medium">{quote.premiumXlm} XLM</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Policy Type</dt>
              <dd className="font-medium">{coverageData.policy_type}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Wallet</dt>
              <dd className="font-medium font-mono text-xs truncate">{address}</dd>
            </div>
          </dl>

          {isQuoteExpired && (
            <div className="flex items-center gap-2 text-orange-600 text-sm" role="alert">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              Quote has expired. Please go back and regenerate.
            </div>
          )}

          <PhaseStatus phase={state.phase} />

          {state.phase === 'polling' && state.txHash && (
            <StellarExplorerLink type="tx" value={state.txHash} label="View on explorer" />
          )}
        </CardContent>
      </Card>

      {/* Allowance approval step */}
      {state.phase === 'approval_needed' && allowanceInfo && premiumStroops && (
        <AllowanceWarning allowance={allowanceInfo} premium={premiumStroops} />
      )}

      {state.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 space-y-3" role="alert">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium text-sm">Submission failed</p>
              <p className="text-sm">{state.error}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleRetry}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Try Again
            </Button>
            {state.error.includes('expired') && (
              <Button size="sm" variant="outline" onClick={onBack}>
                Regenerate Quote
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        {state.phase === 'approval_needed' ? (
          <Button
            onClick={handleApproveSpending}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            <DollarSign className="mr-2 h-4 w-4" aria-hidden="true" />
            Approve Spending
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || isQuoteExpired || state.phase === 'success'}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Processing…</>
            ) : (
              'Sign & Submit'
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
