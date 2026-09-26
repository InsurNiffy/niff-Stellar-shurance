'use client'

import { useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useWallet } from '@/features/wallet'
import type { PolicyDto } from '../api'

interface TransferPolicyModalProps {
  policy: PolicyDto
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address)
}

export function TransferPolicyModal({
  policy,
  open,
  onOpenChange,
  onSuccess,
}: TransferPolicyModalProps) {
  const { toast } = useToast()
  const { address: _address } = useWallet()
  const [step, setStep] = useState<'input' | 'review' | 'signing' | 'done' | 'error'>('input')
  const [newHolder, setNewHolder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)

  const isValidAddress = newHolder.length > 0 && isValidStellarAddress(newHolder)
  const isSameAddress = newHolder === policy.holder

  const handleNext = () => {
    setError(null)
    if (!isValidAddress) {
      setError('Please enter a valid Stellar address (starting with G)')
      return
    }
    if (isSameAddress) {
      setError('New owner must be different from current holder')
      return
    }
    setStep('review')
  }

  const handleConfirm = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      setStep('signing')

      // TODO: Integrate with backend API for transfer_policy transaction building
      // For now, this is a placeholder. When backend endpoint is available:
      // const tx = await PolicyAPI.transferPolicy({
      //   policy_id: policy.policy_id,
      //   new_holder: newHolder,
      //   wallet_address: address,
      // })
      // const signed = await signTransaction(tx.transactionXdr)
      // const result = await PolicyAPI.submitTransaction(signed, '')
      // setTxHash(result.transactionHash)

      // Mock success for now
      await new Promise(resolve => setTimeout(resolve, 2000))
      setStep('done')
      setTxHash('mock-tx-hash')
      toast({
        title: 'Success',
        description: 'Policy transfer initiated successfully.',
      })
      onSuccess?.()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transfer failed'
      setError(errorMessage)
      setStep('error')
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (step === 'signing' || step === 'done' || isSubmitting) return
    setStep('input')
    setNewHolder('')
    setError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Policy</DialogTitle>
          <DialogDescription>
            Transfer ownership of policy #{policy.policy_id} to a new holder
          </DialogDescription>
        </DialogHeader>

        {step === 'input' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-holder">New Owner Address</Label>
              <Input
                id="new-holder"
                placeholder="G..."
                value={newHolder}
                onChange={(e) => {
                  setNewHolder(e.target.value)
                  setError(null)
                }}
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                Enter the Stellar public key (G...) of the new policy holder
              </p>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" aria-hidden="true" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleNext} disabled={!isValidAddress || isSameAddress}>
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted p-4 space-y-3">
              <div className="text-sm">
                <p className="text-muted-foreground">Current Owner</p>
                <p className="font-mono text-xs break-all">{policy.holder}</p>
              </div>
              <div className="text-sm">
                <p className="text-muted-foreground">New Owner</p>
                <p className="font-mono text-xs break-all">{newHolder}</p>
              </div>
              <div className="text-sm">
                <p className="text-muted-foreground">Policy ID</p>
                <p className="font-medium">#{policy.policy_id}</p>
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p className="text-xs text-amber-900">
                This action is permanent. The new holder will have full control over the policy, including the ability to file claims and renew coverage.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('input')}>
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Confirm Transfer'
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'signing' && (
          <div className="space-y-4 py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Waiting for wallet signature…</p>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
              <p className="text-sm font-semibold text-green-900">Transfer Initiated ✓</p>
              {txHash && (
                <p className="text-xs text-green-700 mt-2 break-all">Tx: {txHash.slice(0, 20)}...</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              The policy has been transferred. The dashboard may take up to 15 seconds to reflect the change.
            </p>
            <DialogFooter>
              <Button onClick={handleClose} className="w-full">
                Close
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <p className="text-sm font-semibold text-destructive">Transfer Failed</p>
              {error && (
                <p className="text-xs text-destructive/80 mt-2">{error}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('input')} className="w-full">
                Try Again
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
