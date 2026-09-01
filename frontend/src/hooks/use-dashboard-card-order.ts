'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'niffyinsur-dashboard-card-order-v1'

function readStoredOrder(): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return null
    return parsed
  } catch {
    return null
  }
}

function writeStoredOrder(order: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
  } catch {
    // localStorage may be unavailable (private browsing, quota) — ordering
    // still works for the current session, it just won't persist.
  }
}

/**
 * Reconciles a persisted card order against the current default order:
 * - drops ids that no longer exist (e.g. a card was removed)
 * - appends new default ids that aren't in the stored order yet (e.g. a
 *   card was added after the user last saved a preference)
 */
function reconcile(defaultOrder: string[], stored: string[]): string[] {
  const known = new Set(defaultOrder)
  const kept = stored.filter((id) => known.has(id))
  const missing = defaultOrder.filter((id) => !kept.includes(id))
  return [...kept, ...missing]
}

/**
 * Manages the user's dashboard card order, persisted to localStorage so it
 * survives reloads and future sessions. Falls back to `defaultOrder` when
 * there is no saved preference (or the saved value is invalid/stale).
 */
export function useDashboardCardOrder(defaultOrder: string[]) {
  const [order, setOrder] = useState<string[]>(defaultOrder)
  const [hydrated, setHydrated] = useState(false)

  // Read the persisted preference once, after mount (avoids SSR/client
  // markup mismatch since localStorage isn't available during SSR).
  useEffect(() => {
    const stored = readStoredOrder()
    setOrder(stored ? reconcile(defaultOrder, stored) : defaultOrder)
    setHydrated(true)
    // Only re-run if the set of available cards changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOrder.join('|')])

  const reorder = useCallback((fromId: string, toId: string) => {
    setOrder((prev) => {
      if (fromId === toId) return prev
      const fromIndex = prev.indexOf(fromId)
      const toIndex = prev.indexOf(toId)
      if (fromIndex === -1 || toIndex === -1) return prev

      const next = [...prev]
      next.splice(fromIndex, 1)
      next.splice(toIndex, 0, fromId)
      writeStoredOrder(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY)
    setOrder(defaultOrder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOrder.join('|')])

  return { order, reorder, reset, hydrated }
}
