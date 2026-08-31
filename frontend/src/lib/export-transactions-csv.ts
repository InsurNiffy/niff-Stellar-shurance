import type { HorizonOperationRecord } from '@/lib/api/horizon-transactions'

const CSV_HEADERS = [
  'Date',
  'Type',
  'Amount',
  'Asset',
  'Tx Hash',
  'Status',
  'Contract Events',
  'Raw Timestamp',
] as const

/** Escape a single CSV field per RFC 4180. */
function escapeCsvField(value: string): string {
  if (
    value.includes('"') ||
    value.includes(',') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function rowToCsv(fields: string[]): string {
  return fields.map(escapeCsvField).join(',')
}

/**
 * Build a CSV string from the currently visible transaction records.
 * Returns a header-only CSV when the list is empty.
 */
export function buildTransactionsCsv(
  records: HorizonOperationRecord[],
): string {
  const lines: string[] = [rowToCsv([...CSV_HEADERS])]

  for (const op of records) {
    const date = new Date(op.created_at).toLocaleString()
    const type = op.type
    const amount = op.amount ?? ''
    const asset = op.amount ? (op.asset_code ?? 'XLM') : ''
    const txHash = op.transaction_hash
    const status = op.transaction_successful ? 'success' : 'failed'
    const contractEvents =
      op.contractEvents && op.contractEvents.length > 0
        ? op.contractEvents.map((ev) => ev.description).join('; ')
        : ''
    const rawTimestamp = op.created_at

    lines.push(
      rowToCsv([date, type, amount, asset, txHash, status, contractEvents, rawTimestamp]),
    )
  }

  return lines.join('\n')
}

/** Trigger a CSV file download in the browser. */
export function downloadTransactionsCsv(
  records: HorizonOperationRecord[],
): void {
  const csv = buildTransactionsCsv(records)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()

  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
