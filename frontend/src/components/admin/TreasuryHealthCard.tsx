'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getConfig } from '@/config/env'
import { adminApi, type SolvencySnapshot } from '@/lib/api/admin'
import { apiFetch } from '@/lib/api/fetch'
import { useWallet } from '@/hooks/use-wallet'

export const TREASURY_POLL_INTERVAL_MS = 60_000
/** Minimum solvency ratio the protocol must maintain (1.0 = 100%). */
export const MIN_SOLVENCY_RATIO = 1.0
/** Ratios below this (but above the minimum) are flagged as a warning. */
export const WARN_SOLVENCY_RATIO = 1.2

const STROOPS_PER_XLM = 10_000_000

export type TreasuryHealth = 'healthy' | 'warning' | 'critical'

export function treasuryHealth(ratio: number): TreasuryHealth {
  if (ratio < MIN_SOLVENCY_RATIO) return 'critical'
  if (ratio < WARN_SOLVENCY_RATIO) return 'warning'
  return 'healthy'
}

const HEALTH_STYLES: Record<TreasuryHealth, { dot: string; label: string }> = {
  healthy: { dot: 'bg-green-500', label: 'Healthy' },
  warning: { dot: 'bg-yellow-500', label: 'Warning' },
  critical: { dot: 'bg-red-500', label: 'Critical' },
}

function formatStroops(stroops: string) {
  const n = Number(stroops) / STROOPS_PER_XLM
  return Number.isFinite(n) ? `${n.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM` : stroops
}

/**
 * Treasury health card: current balance, solvency ratio vs. the minimum,
 * and a green/yellow/red indicator. Polls every 60 seconds.
 */
export function TreasuryHealthCard({ jwt }: { jwt: string }) {
  const { address } = useWallet()
  const [snapshot, setSnapshot] = useState<SolvencySnapshot | null>(null)
  const [balanceStroops, setBalanceStroops] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [solvency, balance] = await Promise.all([
        adminApi.getSolvency(jwt),
        address
          ? apiFetch<{ balanceStroops: string }>(
              `${getConfig().apiUrl}/chain/treasury-balance?source_account=${encodeURIComponent(address)}`,
            )
          : Promise.resolve(null),
      ])
      setSnapshot(solvency.snapshot)
      setBalanceStroops(balance?.balanceStroops ?? null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load treasury data')
    } finally {
      setLoading(false)
    }
  }, [jwt, address])

  useEffect(() => {
    load()
    const timer = setInterval(load, TREASURY_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [load])

  const health = snapshot ? treasuryHealth(snapshot.solvencyRatio) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Treasury health
          {health && (
            <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-full ${HEALTH_STYLES[health].dot}`} aria-hidden="true" />
              {HEALTH_STYLES[health].label}
            </span>
          )}
        </CardTitle>
        <CardDescription>Refreshes every 60 seconds.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {health === 'critical' && (
          <div
            role="alert"
            data-testid="treasury-balance-low"
            className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-mono">treasury.balance_low</strong> — treasury balance is below the
              minimum solvency ratio. Top up the treasury before approving further payouts.
            </span>
          </div>
        )}
        {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {!loading && !error && !snapshot && (
          <p className="text-sm text-muted-foreground">No snapshot available yet.</p>
        )}
        {snapshot && (
          <dl className="space-y-2 text-sm">
            <HealthRow
              label="Treasury balance"
              value={balanceStroops ? formatStroops(balanceStroops) : 'Connect wallet to load'}
            />
            <HealthRow label="Solvency ratio" value={`${(snapshot.solvencyRatio * 100).toFixed(2)}%`} />
            <HealthRow label="Minimum solvency ratio" value={`${(MIN_SOLVENCY_RATIO * 100).toFixed(2)}%`} />
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function HealthRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono font-medium">{value}</dd>
    </div>
  )
}
