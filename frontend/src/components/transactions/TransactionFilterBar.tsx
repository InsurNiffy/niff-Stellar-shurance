'use client'

import {
  TRANSACTION_STATUS_OPTIONS,
  type TransactionFilters,
} from './types'

export interface TransactionFilterBarProps {
  filters: TransactionFilters
  onChange: (filters: TransactionFilters) => void
  assetOptions: string[]
}

export function TransactionFilterBar({ filters, onChange, assetOptions }: TransactionFilterBarProps) {
  const handleAsset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...filters, asset: e.target.value })
  }

  const handleStatus = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ ...filters, status: e.target.value as TransactionFilters['status'] })
  }

  const handleStartDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...filters, startDate: e.target.value || null })
  }

  const handleEndDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...filters, endDate: e.target.value || null })
  }

  return (
    <div
      role="search"
      aria-label="Filter transactions"
      className="flex flex-wrap gap-3 items-end p-3 bg-white border rounded-md mb-4"
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Asset
        <select
          value={filters.asset}
          onChange={handleAsset}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          aria-label="Filter by asset"
        >
          <option value="all">All assets</option>
          {assetOptions.map((asset) => (
            <option key={asset} value={asset}>
              {asset}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        Status
        <select
          value={filters.status}
          onChange={handleStatus}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          aria-label="Filter by status"
        >
          {TRANSACTION_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        From
        <input
          type="date"
          value={filters.startDate ?? ''}
          onChange={handleStartDate}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          aria-label="Filter by start date"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
        To
        <input
          type="date"
          value={filters.endDate ?? ''}
          onChange={handleEndDate}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
          aria-label="Filter by end date"
        />
      </label>
    </div>
  )
}
