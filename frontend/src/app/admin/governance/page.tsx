'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldAlert, Settings2 } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { GovernanceCooldownIndicator } from '@/components/admin/GovernanceCooldownIndicator'
import { useAuth } from '@/lib/hooks/useAuth'
import { adminApi } from '@/lib/api/admin'

function isStaff(jwt: string | null): boolean {
  if (!jwt) return false
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'admin' || payload?.isAdmin === true
  } catch {
    return false
  }
}

export default function GovernancePage() {
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
        <div>
          <h1 className="text-2xl font-semibold">Governance Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage quorum parameters and governance configuration.</p>
        </div>
        <Link href="/admin" className="text-sm text-primary underline underline-offset-2">Back to dashboard</Link>
      </div>
      <div className="space-y-6">
        <CooldownStatus jwt={jwt} />
        <QuorumSettings jwt={jwt} />
      </div>
    </main>
  )
}

function QuorumSettings({ jwt }: { jwt: string }) {
  const [currentBps, setCurrentBps] = useState<number | null>(null)
  const [inputBps, setInputBps] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [impact, setImpact] = useState<{ totalActiveClaims: number; affectedCount: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    adminApi.getQuorum(jwt)
      .then((r) => {
        setCurrentBps(r.quorum_bps)
        setInputBps(String(r.quorum_bps))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [jwt])

  const handleOpenConfirm = useCallback(async () => {
    const bps = parseInt(inputBps, 10)
    if (isNaN(bps) || bps < 1 || bps > 10000) {
      setError('Quorum must be between 1 and 10000 basis points (0.01% – 100%).')
      return
    }
    setError(null)
    try {
      const data = await adminApi.getQuorumImpact(jwt, bps)
      setImpact({
        totalActiveClaims: data.totalActiveClaims,
        affectedCount: data.affectedClaims.length,
      })
      setShowConfirm(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to compute impact')
    }
  }, [inputBps, jwt])

  async function handleConfirm() {
    const bps = parseInt(inputBps, 10)
    setSubmitting(true)
    setError(null)
    try {
      const r = await adminApi.setQuorum(jwt, bps)
      setResult(`Transaction built — sign and submit with your wallet. XDR: ${r.unsignedXdr.slice(0, 40)}…`)
      setCurrentBps(bps)
      setShowConfirm(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="h-5 w-5" aria-hidden="true" />
          Quorum Threshold
        </CardTitle>
        <CardDescription>
          Set the minimum proportion of eligible voters required for a vote to be valid, expressed in basis points (bps). 100 bps = 1%.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {result && <p className="text-sm text-green-700 break-all" role="status">{result}</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        <div className="flex items-end gap-4">
          <div className="space-y-1 flex-1">
            <Label htmlFor="quorum-bps">Quorum (bps)</Label>
            <Input
              id="quorum-bps"
              type="number"
              min={1}
              max={10000}
              value={inputBps}
              onChange={(e) => setInputBps(e.target.value)}
              aria-describedby="quorum-helper"
            />
            <p id="quorum-helper" className="text-xs text-muted-foreground">
              Current: <span className="font-mono font-medium">{currentBps} bps</span>
              {' '}({(currentBps !== null ? (currentBps / 100).toFixed(2) : '—')}%)
              {' '}&mdash; Range: 1 – 10,000 bps
            </p>
          </div>
          <Button onClick={handleOpenConfirm} disabled={submitting}>
            Update quorum
          </Button>
        </div>

        <Dialog open={showConfirm} onOpenChange={(v) => !submitting && setShowConfirm(v)}>
          <DialogContent aria-labelledby="quorum-confirm-title" aria-describedby="quorum-confirm-desc">
            <DialogHeader>
              <DialogTitle id="quorum-confirm-title">Confirm quorum update</DialogTitle>
              <DialogDescription id="quorum-confirm-desc">
                This will update the quorum threshold from <strong>{currentBps} bps</strong> to{' '}
                <strong>{inputBps} bps</strong> ({(parseInt(inputBps, 10) / 100).toFixed(2)}%).
                The change affects future claim finalizations only — existing claims retain their current threshold.
              </DialogDescription>
            </DialogHeader>

            {impact && (
              <div className="space-y-3 rounded-lg border bg-muted p-4">
                <p className="text-sm font-medium">Impact on active claims</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Total active claims</p>
                    <p className="text-lg font-semibold tabular-nums">{impact.totalActiveClaims}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Claims with changed quorum</p>
                    <p className="text-lg font-semibold tabular-nums">{impact.affectedCount}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {impact.affectedCount > 0
                    ? `${impact.affectedCount} active claim(s) have a different quorum requirement under the new threshold.`
                    : 'No active claims will be affected by this change.'}
                </p>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={submitting} aria-busy={submitting}>
                {submitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Building…</>
                  : 'Build transaction'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

interface PendingAdminAction {
  currentLedger: number
  expiryLedger: number
  actionType: string
}

function CooldownStatus({ jwt }: { jwt: string }) {
  const [pending, _setPending] = useState<PendingAdminAction | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchCooldownStatus = async () => {
      try {
        setLoading(true)
        // TODO: Replace with actual API call to GET /admin/governance/pending-action
        // const response = await adminApi.getPendingAdminAction(jwt)
        // if (response?.expiryLedger) setPending(response)
      } catch (e: unknown) {
        console.error('Failed to fetch cooldown status:', e instanceof Error ? e.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    void fetchCooldownStatus()
  }, [jwt])

  if (loading || !pending) {
    return null
  }

  return (
    <GovernanceCooldownIndicator
      currentLedger={pending.currentLedger}
      expiryLedger={pending.expiryLedger}
      proposedAction={pending.actionType}
    />
  )
}
