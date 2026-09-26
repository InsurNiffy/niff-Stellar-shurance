'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, ShieldAlert } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/lib/hooks/useAuth'
import { adminApi, type RegisteredVoter } from '@/lib/api/admin'

function isStaff(jwt: string | null): boolean {
  if (!jwt) return false
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'admin' || payload?.isAdmin === true
  } catch {
    return false
  }
}

export default function VotersPage() {
  const { jwt } = useAuth()
  const staff = isStaff(jwt)

  if (!jwt) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">Authentication required</h1>
        <p className="text-sm text-muted-foreground">Connect your wallet and sign in to continue.</p>
      </main>
    )
  }

  if (!staff) {
    return (
      <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-6xl font-bold text-destructive">403</p>
        <h1 className="text-2xl font-semibold">Access denied</h1>
        <p className="text-muted-foreground max-w-sm">You do not have permission to view this page.</p>
        <Link href="/" className="text-primary underline underline-offset-4 text-sm">Return home</Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Governance / Voters</h1>
        <Link href="/admin" className="text-sm text-primary underline underline-offset-2">Back to dashboard</Link>
      </div>
      <VoterList jwt={jwt} />
      <BatchRegisterWidget jwt={jwt} />
    </main>
  )
}

function VoterList({ jwt }: { jwt: string }) {
  const [voters, setVoters] = useState<RegisteredVoter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    adminApi.listVoters(jwt)
      .then(setVoters)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [jwt])

  useEffect(() => { load() }, [load])

  async function handleRemove(voter: RegisteredVoter) {
    setRemoving(voter.walletAddress)
    try {
      await adminApi.removeVoter(jwt, voter.walletAddress)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registered Voters</CardTitle>
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
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Registered By</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {voters.map((v) => (
                  <tr key={v.walletAddress} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono truncate max-w-[20rem]" title={v.walletAddress}>{v.walletAddress}</td>
                    <td className="px-3 py-2 font-mono truncate max-w-[10rem]">{v.registeredBy}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(v.registeredAt).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removing === v.walletAddress}
                        onClick={() => handleRemove(v)}
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
  )
}

function BatchRegisterWidget({ jwt }: { jwt: string }) {
  const [open, setOpen] = useState(false)
  const [addresses, setAddresses] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    const voters = addresses
      .split('\n')
      .map((a) => a.trim())
      .filter((a) => /^G[A-Z2-7]{55}$/.test(a))

    if (voters.length === 0) {
      setError('Enter at least one valid Stellar public key (G...).')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const r = await adminApi.batchRegisterVoters(jwt, voters)
      setResult(`Transaction built — sign and submit with your wallet. XDR: ${r.unsignedXdr.slice(0, 40)}…`)
      setOpen(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batch Register Voters</CardTitle>
        <CardDescription>Add multiple voter addresses in one contract call.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result && <p className="text-sm text-green-700 break-all" role="status">{result}</p>}
        <Button variant="outline" size="sm" onClick={() => { setResult(null); setError(null); setOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Register voters…
        </Button>

        <Dialog open={open} onOpenChange={(v) => !submitting && setOpen(v)}>
          <DialogContent aria-labelledby="batch-title" aria-describedby="batch-desc">
            <DialogHeader>
              <DialogTitle id="batch-title">Register voters</DialogTitle>
              <DialogDescription id="batch-desc">
                Enter Stellar public keys (G...), one per line. All will be registered in a single contract call.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label htmlFor="voter-addresses" className="text-sm font-medium">Voter addresses</label>
              <textarea
                id="voter-addresses"
                rows={6}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="GDVOEGATQV4FGUJKDEBEYT5NAPWJ55MEMJVLC5TU7Y74WD73PPAS4TYW&#10;GBPLT5ZYZFLPVJFU7NZ7TCS6QH4KK3PRIQY2F6V2OCP3B6V6V3F3YH4Q"
                value={addresses}
                onChange={(e) => setAddresses(e.target.value)}
                aria-describedby={error ? 'batch-error' : undefined}
                aria-invalid={!!error}
              />
              {error && <p id="batch-error" className="text-xs text-destructive" role="alert">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={submitting} aria-busy={submitting}>
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Building…</> : 'Build transaction'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}
