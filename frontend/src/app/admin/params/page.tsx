'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { TreasuryHealthCard } from '@/components/admin/TreasuryHealthCard'
import { TxStatusDialog } from '@/components/TxStatusDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useContractTx } from '@/hooks/useContractTx'
import { adminApi, type ProtocolParams, type ProtocolParamsSnapshot } from '@/lib/api/admin'
import { useAuth } from '@/lib/hooks/useAuth'

type ParamKey = keyof ProtocolParams

const FIELDS: { key: ParamKey; label: string; hint: string }[] = [
  { key: 'quorumBps', label: 'Quorum (BPS)', hint: '1–10000 basis points' },
  { key: 'votingDurationLedgers', label: 'Voting duration (ledgers)', hint: 'Positive integer' },
  { key: 'gracePeriodLedgers', label: 'Grace period (ledgers)', hint: 'Non-negative integer' },
  { key: 'fraudScoreThreshold', label: 'Fraud score threshold', hint: '0–100' },
  { key: 'rollingClaimCap', label: 'Rolling claim cap (stroops)', hint: 'Non-negative integer' },
]

function validate(key: ParamKey, value: string): string | null {
  if (!/^\d+$/.test(value)) return 'Must be a whole number'
  const n = Number(value)
  if (key === 'quorumBps' && (n < 1 || n > 10_000)) return 'Must be between 1 and 10000'
  if (key === 'votingDurationLedgers' && n < 1) return 'Must be at least 1'
  if (key === 'fraudScoreThreshold' && n > 100) return 'Must be between 0 and 100'
  return null
}

export default function ProtocolParamsPage() {
  const { jwt } = useAuth()
  const [snapshot, setSnapshot] = useState<ProtocolParamsSnapshot | null>(null)
  const [draft, setDraft] = useState<Record<ParamKey, string> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [txOpen, setTxOpen] = useState(false)

  const load = useCallback(() => {
    if (!jwt) return
    adminApi
      .getProtocolParams(jwt)
      .then((s) => {
        setSnapshot(s)
        setDraft(
          Object.fromEntries(FIELDS.map(({ key }) => [key, String(s.params[key])])) as Record<ParamKey, string>,
        )
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Failed to load parameters'))
  }, [jwt])

  useEffect(load, [load])

  const errors = useMemo(() => {
    if (!draft) return {} as Partial<Record<ParamKey, string>>
    const out: Partial<Record<ParamKey, string>> = {}
    for (const { key } of FIELDS) {
      const err = validate(key, draft[key])
      if (err) out[key] = err
    }
    return out
  }, [draft])

  const changes = useMemo(() => {
    if (!snapshot || !draft) return []
    return FIELDS.filter(({ key }) => draft[key] !== String(snapshot.params[key]))
  }, [snapshot, draft])

  const build = useCallback(async () => {
    if (!jwt || !draft) throw new Error('Not authenticated')
    const patch: Partial<ProtocolParams> = {}
    for (const { key } of changes) {
      if (key === 'rollingClaimCap') patch.rollingClaimCap = draft[key]
      else patch[key] = Number(draft[key])
    }
    const res = await adminApi.updateProtocolParams(jwt, patch)
    return res.unsignedXdr
  }, [jwt, draft, changes])

  const tx = useContractTx({ build, onSuccess: load })

  if (!jwt) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Connect your wallet and sign in to continue.</p>
      </main>
    )
  }

  const hasErrors = Object.keys(errors).length > 0

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Protocol parameters</h1>

      <TreasuryHealthCard jwt={jwt} />

      <Card>
        <CardHeader>
          <CardTitle>Parameters</CardTitle>
          <CardDescription>
            {snapshot
              ? `Current on-chain values (contract ${snapshot.contractVersion}).`
              : 'Loading current on-chain values…'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError && <p className="text-sm text-destructive" role="alert">{loadError}</p>}
          {!draft && !loadError && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
          )}
          {draft && snapshot && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (changes.length && !hasErrors) setReviewOpen(true)
              }}
            >
              {FIELDS.map(({ key, label, hint }) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`param-${key}`}>{label}</Label>
                  <Input
                    id={`param-${key}`}
                    inputMode="numeric"
                    value={draft[key]}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value.trim() })}
                    aria-invalid={Boolean(errors[key])}
                  />
                  <p className="text-xs text-muted-foreground">
                    Current: <span className="font-mono">{String(snapshot.params[key])}</span> · {hint}
                  </p>
                  {errors[key] && <p className="text-xs text-destructive">{errors[key]}</p>}
                </div>
              ))}
              <Button type="submit" disabled={!changes.length || hasErrors || tx.isPending}>
                Review changes
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm parameter changes</DialogTitle>
            <DialogDescription>
              These changes will be submitted on-chain and signed with your wallet.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {changes.map(({ key, label }) => (
              <li key={key} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono">
                  {String(snapshot?.params[key])} → {draft?.[key]}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setReviewOpen(false)
                setTxOpen(true)
                tx.run()
              }}
            >
              Confirm and sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TxStatusDialog
        open={txOpen}
        state={tx.state}
        explorerUrl={tx.result?.explorerUrl}
        error={tx.error?.message}
        onRetry={tx.error?.retryable ? tx.retry : undefined}
        onClose={() => {
          setTxOpen(false)
          if (!tx.isPending) tx.reset()
        }}
      />
    </main>
  )
}
