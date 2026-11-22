export type TransactionStatusFilter = 'all' | 'success' | 'failed'
export type TransactionTypeFilter = 'all' | 'premium' | 'payout' | 'vote' | 'appeal'

export interface TransactionFilters {
  type: TransactionTypeFilter
  asset: string // asset code, or 'all'
  status: TransactionStatusFilter
  startDate: string | null // ISO-8601 date (yyyy-mm-dd)
  endDate: string | null // ISO-8601 date (yyyy-mm-dd)
}

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  type: 'all',
  asset: 'all',
  status: 'all',
  startDate: null,
  endDate: null,
}

export const TRANSACTION_FILTER_QUERY_PARAMS = {
  type: 'type',
  asset: 'asset',
  status: 'status',
  startDate: 'from',
  endDate: 'to',
} as const satisfies Record<keyof TransactionFilters, string>

export const TRANSACTION_TYPE_OPTIONS: Array<{
  value: TransactionTypeFilter
  label: string
}> = [
  { value: 'all', label: 'All types' },
  { value: 'premium', label: 'Premium' },
  { value: 'payout', label: 'Payout' },
  { value: 'vote', label: 'Vote' },
  { value: 'appeal', label: 'Appeal' },
]

export const TRANSACTION_STATUS_OPTIONS: Array<{
  value: TransactionStatusFilter
  label: string
}> = [
  { value: 'all', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
]
