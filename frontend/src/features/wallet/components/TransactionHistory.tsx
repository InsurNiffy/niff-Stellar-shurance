'use client'

// Follow-up: implement CSV export of transaction history.
// Suggested approach: add a "Download CSV" button that calls
// GET /api/v1/account/:address/history/export and triggers a file download.

import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Badge, Button, Card, CardContent, Skeleton } from '@/components/ui'
import { getConfig } from '@/config/env'
import type { TxRecord, TxType } from '@/lib/api/transaction-history'
import { cn } from '@/lib/utils'

import { useTransactionHistory } from '../hooks/useTransactionHistory'
import { EmptyState } from '@/components/ui/empty-state'

const FILTERS: { label: string; value: TxType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Policy', value: 'policy' },
  { label: 'Claims', value: 'claims' },
]

function abbrevHash(hash: string) {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

function CopyHash({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function copy() {
    navigator.clipboard.writeText(hash).then(() => {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      onClick={copy}
      aria-label="Copy transaction hash"
      className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function ExplorerLink({ hash }: { hash: string }) {
  const { explorerBase } = getConfig()
  return (
    <a
      href={`${explorerBase}/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View on Stellar Explorer"
      className="ml-1 inline-flex items-center text-muted-foreground hover:text-primary transition-colors"
    >
      <ExternalLink size={13} />
    </a>
  )
}

function TxRow({ tx }: { tx: TxRecord }) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/40 transition-colors">
      <td className="py-3 px-4 text-sm font-medium">{tx.type}</td>
      <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
        {new Date(tx.timestamp).toLocaleString()}
      </td>
      <td className="py-3 px-4">
        <Badge variant={tx.status === 'success' ? 'success' : 'destructive'} className="capitalize">
          {tx.status}
        </Badge>
      </td>
      <td className="py-3 px-4 font-mono text-xs flex items-center gap-0.5">
        <span>{abbrevHash(tx.hash)}</span>
        <CopyHash hash={tx.hash} />
        <ExplorerLink hash={tx.hash} />
      </td>
    </tr>
  )
}

function TxCard({ tx }: { tx: TxRecord }) {
  return (
    <Card className="mb-3">
      <CardContent className="pt-4 pb-3 px-4 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{tx.type}</span>
          <Badge variant={tx.status === 'success' ? 'success' : 'destructive'} className="capitalize">
            {tx.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{new Date(tx.timestamp).toLocaleString()}</p>
        <div className="font-mono text-xs flex items-center gap-0.5 text-muted-foreground">
          <span className="break-all">{abbrevHash(tx.hash)}</span>
          <CopyHash hash={tx.hash} />
          <ExplorerLink hash={tx.hash} />
        </div>
      </CardContent>
    </Card>
  )
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b">
          {Array.from({ length: 4 }).map((_, j) => (
            <td key={j} className="py-3 px-4">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

interface Props {
  address: string | null
}

export function TransactionHistory({ address }: Props) {
  const { items, isLoading, isLoadingMore, error, hasMore, filter, setFilter, refresh, loadMore } =
    useTransactionHistory(address)

  // Load on mount / address change
  const initialized = useRef(false)
  useEffect(() => {
    if (address && !initialized.current) {
      initialized.current = true
      setFilter('all')
    }
  }, [address, setFilter])

  const isRateLimit = (error as { status?: number } | null)?.status === 429

  return (
    <section aria-label="Transaction History" className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2" role="tablist" aria-label="Filter transactions">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              filter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={refresh}
          aria-label="Refresh"
          className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm space-y-2"
        >
          <p className="font-medium text-destructive">
            {isRateLimit ? 'Rate limit reached. Please wait a moment.' : 'Failed to load transactions.'}
          </p>
          <p className="text-muted-foreground text-xs">
            {isRateLimit
              ? 'Too many requests — try again in a few seconds.'
              : 'Check your network connection and try again.'}
          </p>
          <Button size="sm" variant="outline" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          variant="transactions"
          headline="No transactions yet"
          description="Your transaction history will appear here once you purchase a policy or file a claim."
          ctaLabel="Purchase Policy"
          ctaHref="/policy"
        />
      )}

      {/* Desktop table — hidden on mobile */}
      {(isLoading || items.length > 0) && (
        <div className="hidden sm:block overflow-x-auto rounded-md border">
          <table className="w-full text-left">
            <thead className="bg-muted/50">
              <tr>
                <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Type</th>
                <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                <th className="py-2.5 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hash</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonRows />
              ) : (
                items.map((tx) => <TxRow key={tx.hash} tx={tx} />)
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile card view */}
      {!isLoading && items.length > 0 && (
        <div className="sm:hidden">
          {items.map((tx) => (
            <TxCard key={tx.hash} tx={tx} />
          ))}
        </div>
      )}

      {/* Load More — appends without re-rendering existing rows */}
      {hasMore && !error && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={isLoadingMore}
            aria-label="Load more transactions"
          >
            {isLoadingMore ? 'Loading…' : 'Load More'}
          </Button>
        </div>
      )}
    </section>
  )
}
