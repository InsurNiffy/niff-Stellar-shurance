'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { TxStatusDialog } from '@/components/TxStatusDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getConfig } from '@/config/env'
import { useWallet } from '@/hooks/use-wallet'
import { useContractTx } from '@/hooks/useContractTx'
import { apiFetch } from '@/lib/api/fetch'

/**
 * Vote delegation flow. Backed by the vote delegation endpoints in
 * `backend/src/governance/governance.controller.ts`.
 */

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/

interface DelegationStatus {
  delegatee?: string | null
}

function governanceUrl(path: string) {
  return `${getConfig().apiUrl}/v1/governance/${path}`
}

export default function DelegationPage() {
  const { address } = useWallet()
  const [delegatee, setDelegatee] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const actionRef = useRef<'delegate' | 'undelegate'>('delegate')
  const [txOpen, setTxOpen] = useState(false)

  const loadStatus = useCallback(() => {
    if (!address) return
    setLoading(true)
    setLoadError(null)
    apiFetch<DelegationStatus>(governanceUrl(`delegations/${encodeURIComponent(address)}`))
      .then((res) => setDelegatee(res?.delegatee ?? null))
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Failed to load delegation'))
      .finally(() => setLoading(false))
  }, [address])

  useEffect(loadStatus, [loadStatus])

  const build = useCallback(async () => {
    const action = actionRef.current
    const target = action === 'delegate' ? input.trim() : delegatee
    if (!target) throw new Error('No delegate address')
    const res = await apiFetch<{ xdr: string }>(
      governanceUrl(action === 'delegate' ? 'delegate_vote' : 'revoke_vote_delegation'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delegatee: target }),
      },
    )
    return res.xdr
  }, [input, delegatee])

  const tx = useContractTx({
    build,
    onSuccess: () => {
      setInput('')
      loadStatus()
    },
  })

  const trimmed = input.trim()
  const inputError =
    trimmed && !STELLAR_ADDRESS_REGEX.test(trimmed)
      ? 'Enter a valid Stellar public key (G…)'
      : trimmed && trimmed === address
        ? 'You cannot delegate to yourself'
        : null

  function start(next: 'delegate' | 'undelegate') {
    actionRef.current = next
    setTxOpen(true)
    tx.run()
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Vote delegation</h1>

      {!address ? (
        <p className="text-sm text-muted-foreground">Connect your wallet to manage vote delegation.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Current delegation</CardTitle>
              <CardDescription>Who votes on your behalf in governance proposals.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
              {loadError && <p className="text-sm text-destructive" role="alert">{loadError}</p>}
              {!loading && !loadError && (
                <p className="text-sm" data-testid="delegation-status">
                  {delegatee ? (
                    <>
                      Delegated to <span className="break-all font-mono">{delegatee}</span>
                    </>
                  ) : (
                    'Not delegated — you vote directly.'
                  )}
                </p>
              )}
              {delegatee && (
                <Button variant="outline" onClick={() => start('undelegate')} disabled={tx.isPending}>
                  Undelegate
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{delegatee ? 'Change delegate' : 'Delegate your vote'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (trimmed && !inputError) start('delegate')
                }}
              >
                <Label htmlFor="delegate-address">Delegate wallet address</Label>
                <Input
                  id="delegate-address"
                  placeholder="G…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  aria-invalid={Boolean(inputError)}
                />
                {inputError && <p className="text-xs text-destructive">{inputError}</p>}
                <Button type="submit" disabled={!trimmed || Boolean(inputError) || tx.isPending}>
                  Delegate
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}

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
