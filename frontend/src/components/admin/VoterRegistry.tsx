'use client'

import { useState, type FormEvent } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import type { RegisteredVoter } from '@/lib/api/admin'

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/

export interface VoterRegistryProps {
  voters: RegisteredVoter[]
  loading?: boolean
  error?: string | null
  onRegister: (walletAddress: string) => Promise<void>
  onRemove: (walletAddress: string) => Promise<void>
}

export function VoterRegistry({ voters, loading = false, error = null, onRegister, onRemove }: VoterRegistryProps) {
  const [address, setAddress] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const walletAddress = address.trim()
    if (!STELLAR_ADDRESS.test(walletAddress)) {
      setFormError('Enter a valid Stellar public key (G...).')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      await onRegister(walletAddress)
      setAddress('')
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(walletAddress: string) {
    setRemoving(walletAddress)
    try {
      await onRemove(walletAddress)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Register Voter</CardTitle>
          <CardDescription>Add a wallet address to the voter registry.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="flex-1 space-y-1">
              <label htmlFor="voter-address" className="sr-only">Wallet address</label>
              <input
                id="voter-address"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="G..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                aria-invalid={!!formError}
                aria-describedby={formError ? 'voter-address-error' : undefined}
              />
              {formError && <p id="voter-address-error" className="text-xs text-destructive" role="alert">{formError}</p>}
            </div>
            <Button type="submit" disabled={submitting} aria-busy={submitting}>
              {submitting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                : <Plus className="mr-2 h-4 w-4" aria-hidden="true" />}
              Register
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voter Registry</CardTitle>
          <CardDescription>Wallet addresses eligible to vote on claims.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
          {error && <p className="text-sm text-destructive mb-2" role="alert">{error}</p>}
          {!loading && voters.length === 0 && (
            <p className="text-sm text-muted-foreground">No registered voters yet.</p>
          )}
          {voters.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Wallet Address</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Registration Date</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {voters.map((v) => (
                    <tr key={v.walletAddress} className="hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono truncate max-w-[20rem]" title={v.walletAddress}>{v.walletAddress}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{new Date(v.registeredAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={removing === v.walletAddress}
                          onClick={() => handleRemove(v.walletAddress)}
                          aria-label={`Remove ${v.walletAddress}`}
                        >
                          {removing === v.walletAddress
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4 text-destructive" />}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
