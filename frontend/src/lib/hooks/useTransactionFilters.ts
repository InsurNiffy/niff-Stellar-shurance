'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'

import {
  DEFAULT_TRANSACTION_FILTERS,
  TRANSACTION_FILTER_QUERY_PARAMS,
  TRANSACTION_STATUS_OPTIONS,
  TRANSACTION_TYPE_OPTIONS,
  type TransactionFilters,
} from '@/components/transactions/types'

const VALID_STATUSES = new Set(TRANSACTION_STATUS_OPTIONS.map((opt) => opt.value))
const VALID_TYPES = new Set(TRANSACTION_TYPE_OPTIONS.map((opt) => opt.value))

/**
 * Reads TransactionFilters from the URL on mount and writes changes back via
 * router.replace (no new history entry), so a filtered view stays shareable
 * and bookmarkable without a full page reload.
 */
export function useTransactionFilters(): [
  TransactionFilters,
  (filters: TransactionFilters) => void,
] {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [filters] = useState<TransactionFilters>(() => parseFiltersFromParams(searchParams))

  const setFilters = useCallback(
    (next: TransactionFilters) => {
      const params = new URLSearchParams(searchParams.toString())

      if (next.type !== DEFAULT_TRANSACTION_FILTERS.type) {
        params.set(TRANSACTION_FILTER_QUERY_PARAMS.type, next.type)
      } else {
        params.delete(TRANSACTION_FILTER_QUERY_PARAMS.type)
      }

      if (next.asset !== DEFAULT_TRANSACTION_FILTERS.asset) {
        params.set(TRANSACTION_FILTER_QUERY_PARAMS.asset, next.asset)
      } else {
        params.delete(TRANSACTION_FILTER_QUERY_PARAMS.asset)
      }

      if (next.status !== DEFAULT_TRANSACTION_FILTERS.status) {
        params.set(TRANSACTION_FILTER_QUERY_PARAMS.status, next.status)
      } else {
        params.delete(TRANSACTION_FILTER_QUERY_PARAMS.status)
      }

      if (next.startDate) {
        params.set(TRANSACTION_FILTER_QUERY_PARAMS.startDate, next.startDate)
      } else {
        params.delete(TRANSACTION_FILTER_QUERY_PARAMS.startDate)
      }

      if (next.endDate) {
        params.set(TRANSACTION_FILTER_QUERY_PARAMS.endDate, next.endDate)
      } else {
        params.delete(TRANSACTION_FILTER_QUERY_PARAMS.endDate)
      }

      const query = params.toString()
      router.replace(query ? `?${query}` : '?', { scroll: false })
    },
    [router, searchParams],
  )

  return [filters, setFilters]
}

function parseFiltersFromParams(
  searchParams: ReturnType<typeof useSearchParams>,
): TransactionFilters {
  const type = searchParams.get(TRANSACTION_FILTER_QUERY_PARAMS.type)
  const asset = searchParams.get(TRANSACTION_FILTER_QUERY_PARAMS.asset)
  const status = searchParams.get(TRANSACTION_FILTER_QUERY_PARAMS.status)
  const startDate = searchParams.get(TRANSACTION_FILTER_QUERY_PARAMS.startDate)
  const endDate = searchParams.get(TRANSACTION_FILTER_QUERY_PARAMS.endDate)

  return {
    type: type && VALID_TYPES.has(type as TransactionFilters['type'])
      ? (type as TransactionFilters['type'])
      : DEFAULT_TRANSACTION_FILTERS.type,
    asset: asset || DEFAULT_TRANSACTION_FILTERS.asset,
    status: status && VALID_STATUSES.has(status as TransactionFilters['status'])
      ? (status as TransactionFilters['status'])
      : DEFAULT_TRANSACTION_FILTERS.status,
    startDate: startDate || DEFAULT_TRANSACTION_FILTERS.startDate,
    endDate: endDate || DEFAULT_TRANSACTION_FILTERS.endDate,
  }
}
