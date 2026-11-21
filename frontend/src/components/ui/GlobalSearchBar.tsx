'use client'

import { ClipboardList, FileText, Search, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Badge, type BadgeProps } from '@/components/ui/badge'
import { getConfig } from '@/config/env'
import { cn } from '@/lib/utils'

const DEBOUNCE_MS = 300

type ResultType = 'policy' | 'claim'
type ResultStatus =
  | 'Active'
  | 'Expired'
  | 'Pending'
  | 'Approved'
  | 'Rejected'
  | 'Under Review'
  | 'Paid'
  | 'Withdrawn'

interface SearchResult {
  id: string
  status: ResultStatus
  href: string
  type: ResultType
}

const STATUS_VARIANT: Record<ResultStatus, BadgeProps['variant']> = {
  Active: 'success',
  Expired: 'outline',
  Pending: 'warning',
  Approved: 'success',
  Rejected: 'destructive',
  'Under Review': 'warning',
  Paid: 'success',
  Withdrawn: 'secondary',
}

function normalizeStatus(raw: unknown, type: ResultType, isActive?: boolean): ResultStatus {
  const value = typeof raw === 'string' ? raw.toLowerCase().replace(/[\s_]/g, '') : ''
  const statuses: Record<string, ResultStatus> = {
    active: 'Active',
    expired: 'Expired',
    pending: 'Pending',
    processing: 'Under Review',
    underappeal: 'Under Review',
    approved: 'Approved',
    rejected: 'Rejected',
    paid: 'Paid',
    withdrawn: 'Withdrawn',
  }
  if (statuses[value]) return statuses[value]
  if (type === 'policy') return isActive === false ? 'Expired' : 'Active'
  return 'Pending'
}

async function fetchById<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function lookup(query: string, apiUrl: string, signal: AbortSignal): Promise<SearchResult[]> {
  const id = encodeURIComponent(query)
  const [policy, claim] = await Promise.all([
    fetchById<Record<string, unknown>>(`${apiUrl}/api/policies/${id}`, signal),
    fetchById<Record<string, unknown>>(`${apiUrl}/api/claims/${id}`, signal),
  ])

  const results: SearchResult[] = []
  if (policy && !signal.aborted) {
    const policyId = policy.policy_id ?? policy.id
    if (policyId !== undefined && policyId !== null) {
      results.push({
        id: String(policyId),
        status: normalizeStatus(policy.status, 'policy', policy.is_active as boolean | undefined),
        href: `/policies/${encodeURIComponent(String(policyId))}`,
        type: 'policy',
      })
    }
  }
  if (claim && !signal.aborted) {
    const claimId = claim.claim_id ?? claim.id
    if (claimId !== undefined && claimId !== null) {
      results.push({
        id: String(claimId),
        status: normalizeStatus(claim.status, 'claim'),
        href: `/claims/${encodeURIComponent(String(claimId))}`,
        type: 'claim',
      })
    }
  }
  return results
}

export function GlobalSearchBar({ className }: { className?: string }) {
  const router = useRouter()
  const { apiUrl } = getConfig()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null)

  // Ctrl/Cmd+K focuses the search input from anywhere on the site.
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [])

  useEffect(() => {
    // Cancel any in-flight lookup when the component unmounts.
    return () => requestRef.current?.controller.abort()
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      requestRef.current?.controller.abort()
      requestRef.current = null
      setResults([])
      setLoading(false)
      setOpen(false)
      return
    }

    const controller = new AbortController()
    const requestId = (requestRef.current?.id ?? 0) + 1
    requestRef.current?.controller.abort()
    requestRef.current = { id: requestId, controller }

    const timer = setTimeout(async () => {
      setLoading(true)
      const found = await lookup(trimmed, apiUrl, controller.signal)
      if (requestRef.current?.id !== requestId || controller.signal.aborted) return
      setResults(found)
      setActiveIdx(-1)
      setLoading(false)
      setOpen(true)
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [query, apiUrl])

  const select = useCallback(
    (result: SearchResult) => {
      requestRef.current?.controller.abort()
      setOpen(false)
      setQuery('')
      setResults([])
      router.push(result.href)
    },
    [router],
  )

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false)
      setActiveIdx(-1)
      return
    }
    if (!open || results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIdx((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIdx((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (event.key === 'Enter' && activeIdx >= 0) {
      event.preventDefault()
      select(results[activeIdx])
    }
  }

  return (
    <div className={cn('relative', className)} role="search">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search policies and claims by ID"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="global-search-listbox"
          aria-activedescendant={activeIdx >= 0 ? `search-result-${activeIdx}` : undefined}
          placeholder="Search policies & claims…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => { if (results.length) setOpen(true) }}
          className="h-9 w-48 rounded-md border border-input bg-background pl-9 pr-14 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-64"
        />
        <kbd className="pointer-events-none absolute right-2 hidden rounded border px-1 text-[10px] text-muted-foreground sm:block" aria-hidden="true">
          ⌘K
        </kbd>
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              requestRef.current?.controller.abort()
              setQuery('')
              setResults([])
              setOpen(false)
              inputRef.current?.focus()
            }}
            className="absolute right-7 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <ul
          id="global-search-listbox"
          role="listbox"
          aria-label="Search results"
          className="absolute z-50 mt-1 w-full min-w-64 overflow-hidden rounded-md border bg-popover shadow-md"
        >
          {loading && <li className="px-3 py-2 text-sm text-muted-foreground" role="status">Searching…</li>}
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground" role="status">No results found.</li>
          )}
          {!loading && results.map((result, index) => {
            const Icon = result.type === 'policy' ? FileText : ClipboardList
            return (
              <li
                key={`${result.type}-${result.id}`}
                id={`search-result-${index}`}
                role="option"
                aria-selected={activeIdx === index}
                onMouseDown={(event) => { event.preventDefault(); select(result) }}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                  activeIdx === index ? 'bg-accent text-accent-foreground' : 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{result.type === 'policy' ? 'Policy' : 'Claim'} #{result.id}</span>
                <Badge variant={STATUS_VARIANT[result.status]} className="ml-auto shrink-0">
                  {result.status}
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
