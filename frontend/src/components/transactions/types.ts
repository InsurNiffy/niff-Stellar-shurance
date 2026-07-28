export type TransactionStatusFilter = 'all' | 'success' | 'failed'

export interface TransactionFilters {
  asset: string // asset code, or 'all'
  status: TransactionStatusFilter
  startDate: string | null // ISO-8601 date (yyyy-mm-dd)
  endDate: string | null // ISO-8601 date (yyyy-mm-dd)
}

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  asset: 'all',
  status: 'all',
  startDate: null,
  endDate: null,
}

export const TRANSACTION_FILTER_QUERY_PARAMS = {
  asset: 'asset',
  status: 'status',
  startDate: 'from',
  endDate: 'to',
} as const satisfies Record<keyof TransactionFilters, string>

export const TRANSACTION_STATUS_OPTIONS: Array<{
  value: TransactionStatusFilter
  label: string
}> = [
  { value: 'all', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
]
