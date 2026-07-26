'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, RefreshCw, ShieldAlert, Tag, AlertCircle, CheckCircle2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/hooks/useAuth'
import {
  adminApi,
  type AuditEntry,
  type FeatureFlag,
  type SolvencySnapshot,
  type EvidenceLimits,
  type KeeperActionResult,
} from '@/lib/api/admin'
import { getConfig } from '@/config/env'
import { getPrimaryContractVersion } from '@/lib/network-manifest'

// ── Contract version header ────────────────────────────────────────────────

/**
 * Fetches the deployed contract semantic version via get_contract_metadata
 * simulation from the backend, falling back to the registry's deployedVersion.
 */
function useContractVersion() {
  const { apiUrl, network } = getConfig()
  const [version, setVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Try the backend simulation endpoint first
    fetch(`${apiUrl}/api/contracts/metadata`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('metadata fetch failed')
        const data = await res.json() as { version?: string }
        if (data?.version) setVersion(data.version)
        else throw new Error('no version in response')
      })
      .catch(() => {
        // Fallback: read from deployment-registry.json bundled with the app
        const v = getPrimaryContractVersion(network as 'testnet' | 'mainnet')
        setVersion(v ?? null)
      })
      .finally(() => setLoading(false))
  }, [apiUrl, network])

  return { version, loading }
}

function ContractVersionBadge() {
  const { version, loading } = useContractVersion()
  const { network } = getConfig()

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-muted bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground animate-pulse">
        <Tag className="h-3 w-3" aria-hidden="true" />
        Loading…
      </span>
    )
  }

  if (!version) return null

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-mono font-medium text-foreground"
      title={`Deployed contract version on ${network}`}
      aria-label={`Contract version ${version} on ${network}`}
    >
      <Tag className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      {version}
      <span className="text-muted-foreground font-sans normal-case">·&nbsp;{network}</span>
    </span>
  )
}

// ── JWT role helper ────────────────────────────────────────────────────────

function isStaff(jwt: string | null): boolean {
  if (!jwt) return false
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'admin' || payload?.isAdmin === true
  } catch {
    return false
  }
}

// ── Root component ─────────────────────────────────────────────────────────

export default function AdminPage() {
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
        <p className="text-muted-foreground max-w-sm">
          You do not have permission to view this page. Staff authentication is required.
        </p>
        <Link href="/" className="text-primary underline underline-offset-4 text-sm">
          Return home
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <ContractVersionBadge />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <SolvencyWidget jwt={jwt} />
        <ReindexWidget jwt={jwt} />
      </div>
      <EvidenceLimitsWidget jwt={jwt} />
      <FeatureFlagsWidget jwt={jwt} />
      <AuditLogWidget jwt={jwt} />
    </main>
  )
}

// ── Solvency widget ────────────────────────────────────────────────────────

function SolvencyWidget({ jwt }: { jwt: string }) {
  const [snapshot, setSnapshot] = useState<SolvencySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    adminApi.getSolvency(jwt)
      .then((r) => setSnapshot(r.snapshot))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [jwt])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Solvency</CardTitle>
        <CardDescription>Latest cached snapshot — no live RPC call.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {!loading && !error && !snapshot && (
          <p className="text-sm text-muted-foreground">No snapshot available yet.</p>
        )}
        {snapshot && (
          <dl className="space-y-2 text-sm">
            <Row label="Solvency ratio" value={`${(snapshot.solvencyRatio * 100).toFixed(2)}%`} />
            <Row label="Premium reserve" value={snapshot.totalPremiumReserve} />
            <Row label="Total exposure" value={snapshot.totalExposure} />
            <Row label="Captured at" value={new Date(snapshot.capturedAt).toLocaleString()} />
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono font-medium">{value}</dd>
    </div>
  )
}

// ── Reindex widget ─────────────────────────────────────────────────────────

function ReindexWidget({ jwt }: { jwt: string }) {
  const [open, setOpen] = useState(false)
  const [ledger, setLedger] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { network } = getConfig()

  async function handleConfirm() {
    const from = parseInt(ledger, 10)
    if (!Number.isFinite(from) || from < 0) {
      setError('Enter a valid ledger sequence number.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const r = await adminApi.triggerReindex(jwt, from, network)
      setResult(`Job queued: ${r.jobId}`)
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
        <CardTitle>Reindex</CardTitle>
        <CardDescription>Enqueue a ledger reindex job from a given sequence.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {result && <p className="text-sm text-green-700" role="status">{result}</p>}
        <Button variant="outline" size="sm" onClick={() => { setResult(null); setError(null); setOpen(true) }}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Trigger reindex…
        </Button>

        <Dialog open={open} onOpenChange={(v) => !submitting && setOpen(v)}>
          <DialogContent aria-labelledby="reindex-title" aria-describedby="reindex-desc">
            <DialogHeader>
              <DialogTitle id="reindex-title">Confirm reindex</DialogTitle>
              <DialogDescription id="reindex-desc">
                This enqueues a background job to reindex all ledgers from the given sequence.
                It may take several minutes and will increase backend load.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label htmlFor="from-ledger" className="text-sm font-medium">From ledger sequence</label>
              <Input
                id="from-ledger"
                type="number"
                min={0}
                placeholder="e.g. 1000000"
                value={ledger}
                onChange={(e) => setLedger(e.target.value)}
                aria-describedby={error ? 'reindex-error' : undefined}
                aria-invalid={!!error}
              />
              {error && <p id="reindex-error" className="text-xs text-destructive" role="alert">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={submitting} aria-busy={submitting}>
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Queuing…</> : 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ── Feature flags widget ───────────────────────────────────────────────────

function FeatureFlagsWidget({ jwt }: { jwt: string }) {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  useEffect(() => {
    adminApi.listFeatureFlags(jwt)
      .then(setFlags)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [jwt])

  async function handleToggle(flag: FeatureFlag) {
    setToggling(flag.key)
    try {
      const updated = await adminApi.setFeatureFlag(jwt, flag.key, !flag.enabled)
      setFlags((prev) => prev.map((f) => f.key === updated.key ? updated : f))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Toggle failed')
    } finally {
      setToggling(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feature flags</CardTitle>
        <CardDescription>Toggle feature flags. Changes take effect immediately.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
        {error && <p className="text-sm text-destructive mb-2" role="alert">{error}</p>}
        {!loading && flags.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No feature flags configured.</p>
        )}
        <ul className="divide-y" role="list">
          {flags.map((flag) => (
            <li key={flag.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium font-mono">{flag.key}</p>
                {flag.description && <p className="text-xs text-muted-foreground">{flag.description}</p>}
              </div>
              <button
                role="switch"
                aria-checked={flag.enabled}
                aria-label={`Toggle ${flag.key}`}
                disabled={toggling === flag.key}
                onClick={() => handleToggle(flag)}
                className={[
                  'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                  'disabled:opacity-50',
                  flag.enabled ? 'bg-primary' : 'bg-input',
                ].join(' ')}
              >
                <span className="sr-only">{flag.enabled ? 'Enabled' : 'Disabled'}</span>
                <span
                  aria-hidden="true"
                  className={[
                    'inline-block h-5 w-5 rounded-full bg-background shadow transition-transform',
                    flag.enabled ? 'translate-x-5' : 'translate-x-0',
                  ].join(' ')}
                />
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// ── Audit log widget ───────────────────────────────────────────────────────

const PAGE_SIZE = 20

function AuditLogWidget({ jwt }: { jwt: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterAction, setFilterAction] = useState('')
  const [filterActor, setFilterActor] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback((action: string, actor: string, append = false, cur?: string) => {
    setLoading(true)
    adminApi.getAudits(jwt, { limit: PAGE_SIZE, action: action || undefined, actor: actor || undefined, cursor: cur })
      .then((page) => {
        setEntries((prev) => append ? [...prev, ...page.items] : page.items)
        setCursor(page.nextCursor)
        setHasMore(!!page.nextCursor)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed'))
      .finally(() => setLoading(false))
  }, [jwt])

  // Initial load
  useEffect(() => { load('', '') }, [load])

  // Debounced filter
  function handleFilter(action: string, actor: string) {
    setFilterAction(action)
    setFilterActor(actor)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(action, actor), 300)
  }

  const exportUrl = adminApi.exportAuditsUrl(jwt, filterAction || undefined, filterActor || undefined)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>Immutable record of all admin actions.</CardDescription>
        </div>
        <a
          href={exportUrl}
          download="audit-log.csv"
          className="inline-flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline"
          aria-label="Export audit log as CSV"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export CSV
        </a>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Filter by action"
            value={filterAction}
            onChange={(e) => handleFilter(e.target.value, filterActor)}
            className="h-8 w-44 text-xs"
            aria-label="Filter by action"
          />
          <Input
            placeholder="Filter by actor"
            value={filterActor}
            onChange={(e) => handleFilter(filterAction, e.target.value)}
            className="h-8 w-52 text-xs"
            aria-label="Filter by actor"
          />
        </div>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

        {/* Table */}
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {['Time', 'Actor', 'Action', 'Details'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 whitespace-nowrap font-mono">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono truncate max-w-[10rem]" title={e.actor}>{e.actor}</td>
                  <td className="px-3 py-2 font-mono">{e.action}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[16rem]">
                    {JSON.stringify(e.payload)}
                  </td>
                </tr>
              ))}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                    No audit entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="flex justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        )}

        {hasMore && !loading && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(filterAction, filterActor, true, cursor)}
          >
            Load more
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ── #929 Evidence Limits widget ────────────────────────────────────────────

function EvidenceLimitsWidget({ jwt }: { jwt: string }) {
  const [limits, setLimits] = useState<EvidenceLimits | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minInput, setMinInput] = useState('')
  const [maxInput, setMaxInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<KeeperActionResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    adminApi.getEvidenceLimits(jwt)
      .then((l) => {
        setLimits(l)
        setMinInput(String(l.minEvidenceCount))
        setMaxInput(String(l.maxEvidenceCount))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [jwt])

  const minVal = parseInt(minInput, 10)
  const maxVal = parseInt(maxInput, 10)
  const minValid = Number.isFinite(minVal) && minVal >= 0
  const maxValid = Number.isFinite(maxVal) && maxVal > 0
  const orderValid = minValid && maxValid && minVal <= maxVal

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orderValid) return
    setSubmitting(true)
    setSubmitError(null)
    setResult(null)
    try {
      const r = await adminApi.setEvidenceLimits(jwt, minVal, maxVal)
      setResult(r)
      setLimits({ minEvidenceCount: minVal, maxEvidenceCount: maxVal })
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence Limits</CardTitle>
        <CardDescription>
          Set the minimum and maximum number of evidence items required per claim.
          Inline validation prevents submitting min &gt; max.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {limits && (
          <dl className="space-y-2 text-sm">
            <Row label="Current min" value={String(limits.minEvidenceCount)} />
            <Row label="Current max" value={String(limits.maxEvidenceCount)} />
          </dl>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-4 items-end">
            <div className="space-y-1">
              <label htmlFor="evidence-min" className="text-sm font-medium">Min</label>
              <Input
                id="evidence-min"
                type="number"
                min={0}
                value={minInput}
                onChange={(e) => { setMinInput(e.target.value); setResult(null) }}
                aria-invalid={minInput !== '' && !minValid}
                className="h-8 w-20 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="evidence-max" className="text-sm font-medium">Max</label>
              <Input
                id="evidence-max"
                type="number"
                min={1}
                value={maxInput}
                onChange={(e) => { setMaxInput(e.target.value); setResult(null) }}
                aria-invalid={maxInput !== '' && !maxValid}
                className="h-8 w-20 text-sm"
              />
            </div>
          </div>
          {minValid && maxValid && !orderValid && (
            <p className="text-xs text-destructive flex items-center gap-1" role="alert">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Min must not exceed max
            </p>
          )}
          {submitError && <p className="text-xs text-destructive" role="alert">{submitError}</p>}
          {result && (
            <p className="text-xs text-green-700 flex items-center gap-1" role="status">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Updated — tx {result.txHash.slice(0, 12)}…
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={submitting || !orderValid}
            aria-busy={submitting}
          >
            {submitting
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Updating…</>
              : 'Update limits'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
