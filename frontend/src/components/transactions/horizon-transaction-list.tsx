'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  fetchHorizonTransactions,
  type HorizonOperationRecord,
} from '@/lib/api/horizon-transactions'
import { downloadTransactionsCsv } from '@/lib/export-transactions-csv'
import { cn } from '@/lib/utils'

import { TransactionFilterBar } from './TransactionFilterBar'
import { DEFAULT_TRANSACTION_FILTERS, type TransactionFilters } from './types'

function assetCodeOf(op: HorizonOperationRecord): string {
  return op.asset_code ?? 'XLM'
}

function matchesFilters(op: HorizonOperationRecord, filters: TransactionFilters): boolean {
  if (filters.asset !== 'all' && assetCodeOf(op) !== filters.asset) return false

  if (filters.status === 'success' && !op.transaction_successful) return false
  if (filters.status === 'failed' && op.transaction_successful) return false

  const createdAt = new Date(op.created_at).getTime()
  if (filters.startDate) {
    const start = new Date(filters.startDate).getTime()
    if (createdAt < start) return false
  }
  if (filters.endDate) {
    // Treat the end date as inclusive of the whole day.
    const end = new Date(filters.endDate).getTime() + 24 * 60 * 60 * 1000
    if (createdAt >= end) return false
  }

  return true
}

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
  filters?: TransactionFilters
  onFiltersChange?: (filters: TransactionFilters) => void
}

export function HorizonTransactionList({
  account,
  filters = DEFAULT_TRANSACTION_FILTERS,
  onFiltersChange,
}: HorizonTransactionListProps) {
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

  const assetOptions = useMemo(() => {
    const codes = new Set(records.map(assetCodeOf))
    return Array.from(codes).sort()
  }, [records])

  const filteredRecords = useMemo(
    () => records.filter((op) => matchesFilters(op, filters)),
    [records, filters],
  )

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
      {!isLoading && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadTransactionsCsv(records)}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      )}

      {isLoading ? (
        <LoadingRows />
      ) : filteredRecords.length === 0 ? (
        <EmptyState
          variant="transactions"
          headline="No matching transactions"
          description="No transactions match the selected filters. Try adjusting or clearing them."
          secondaryLabel="Clear filters"
          onSecondaryClick={() => onFiltersChange?.(DEFAULT_TRANSACTION_FILTERS)}
        />
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
