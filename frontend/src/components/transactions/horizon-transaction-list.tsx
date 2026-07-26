'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  fetchHorizonTransactions,
  type HorizonOperationRecord,
} from '@/lib/api/horizon-transactions'
import { cn } from '@/lib/utils'

function formatOperationSummary(op: HorizonOperationRecord): string {
  const parts = [op.type]
  if (op.amount) parts.push(`${op.amount} ${op.asset_code ?? 'XLM'}`)
  return parts.join(' · ')
}

function TransactionRow({ op }: { op: HorizonOperationRecord }) {
  return (
    <article
      className="rounded-md border p-4 space-y-2"
      aria-label={`Transaction ${op.transaction_hash}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{formatOperationSummary(op)}</p>
        <time className="text-xs text-muted-foreground" dateTime={op.created_at}>
          {new Date(op.created_at).toLocaleString()}
        </time>
      </div>

      {op.contractEvents && op.contractEvents.length > 0 && (
        <ul className="space-y-1" aria-label="Contract events">
          {op.contractEvents.map((ev, i) => (
            <li key={`${op.id}-ev-${i}`} className="text-sm text-primary">
              {ev.description}
            </li>
          ))}
        </ul>
      )}

      <dl className="grid gap-1 text-xs text-muted-foreground font-mono">
        <div className="flex gap-2">
          <dt className="shrink-0">Tx hash</dt>
          <dd className="truncate">{op.transaction_hash}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0">Type</dt>
          <dd>{op.type}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0">Status</dt>
          <dd>{op.transaction_successful ? 'success' : 'failed'}</dd>
        </div>
      </dl>
    </article>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading transactions">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  )
}

interface HorizonTransactionListProps {
  account: string | null
}

export function HorizonTransactionList({ account }: HorizonTransactionListProps) {
  const [records, setRecords] = useState<HorizonOperationRecord[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  const loadPage = useCallback(
    async (append: boolean, pageCursor?: string) => {
      if (!account) return
      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
        setError(null)
      }
      try {
        const page = await fetchHorizonTransactions(account, pageCursor)
        setRecords((prev) => (append ? [...prev, ...page.records] : page.records))
        setCursor(page.next_cursor)
        setHasMore(Boolean(page.next_cursor))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load transactions')
      } finally {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    },
    [account],
  )

  useEffect(() => {
    setRecords([])
    setCursor(undefined)
    setHasMore(false)
    if (account) void loadPage(false)
  }, [account, loadPage])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore || isLoading || isLoadingMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor) {
          void loadPage(true, cursor)
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, hasMore, isLoading, isLoadingMore, loadPage])

  const operationTypes = useMemo(() => {
    const types = new Set(records.map((r) => r.type))
    return Array.from(types).sort()
  }, [records])

  const filteredRecords = useMemo(() => {
    if (!typeFilter) return records
    return records.filter((r) => r.type === typeFilter)
  }, [records, typeFilter])

  if (!account) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Connect your wallet to view transaction history.
      </p>
    )
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive text-center py-8">
        {error}
      </p>
    )
  }

  // Genuinely empty: no transactions at all for this wallet
  if (!isLoading && records.length === 0) {
    return (
      <EmptyState
        variant="transactions"
        headline="No transactions yet"
        description="Your on-chain activity will appear here once you interact with the protocol. Purchase a policy or file a claim to get started."
        ctaLabel="Purchase a Policy"
        ctaHref="/purchase"
        secondaryLabel="File a Claim"
        onSecondaryClick={() => { window.location.href = '/claims' }}
      />
    )
  }

  return (
    <section aria-label="Transaction history" className="space-y-3">
      {!isLoading && records.length > 0 && (
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by type"
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All types</option>
            {operationTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {typeFilter && (
            <button
              type="button"
              onClick={() => setTypeFilter('')}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <LoadingRows />
      ) : filteredRecords.length === 0 ? (
        // Filtered-to-empty: transactions exist but filter hides them all
        <div
          role="status"
          className="flex flex-col items-center py-12 text-center gap-2"
        >
          <p className="text-sm font-medium text-gray-900">No matching transactions</p>
          <p className="text-sm text-muted-foreground">
            No transactions match the current filter. Try selecting a different type or clear the filter.
          </p>
          <button
            type="button"
            onClick={() => setTypeFilter('')}
            className="mt-2 text-sm text-blue-600 underline underline-offset-2 hover:text-blue-700"
          >
            Clear filter
          </button>
        </div>
      ) : (
        filteredRecords.map((op) => <TransactionRow key={op.id} op={op} />)
      )}

      <div
        ref={loadMoreRef}
        className={cn('h-8 flex items-center justify-center', !hasMore && 'hidden')}
        aria-hidden={!hasMore}
      >
        {isLoadingMore && (
          <span className="text-xs text-muted-foreground">Loading more…</span>
        )}
      </div>
    </section>
  )
}
