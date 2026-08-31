'use client'

import { useLocale } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { useWallet } from '../hooks/useWallet'
import { useWalletBalances } from '../hooks/useWalletBalances'
import { formatDecimalNumber } from '@/lib/format-number'

/** Format a Horizon balance string (e.g. "1234.5678900") to a readable value. */
function formatBalance(balance: string, locale: string): string {
  const n = parseFloat(balance)
  if (isNaN(n)) return balance
  return formatDecimalNumber(n, locale)
}

/** Extract a short display label from an asset string like "TOKEN:GISSUER..." */
function assetLabel(asset: string): string {
  if (asset === 'XLM') return 'XLM'
  return asset.split(':')[0]
}

export function WalletBalanceDisplay() {
  const locale = useLocale()
  const { address, connectionStatus } = useWallet()
  const { data: balances, isLoading, isError } = useWalletBalances(address)

  if (connectionStatus !== 'connected' || !address) return null

  if (isLoading) {
    return (
      <span className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Loading balances">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading balances</span>
      </span>
    )
  }

  if (isError || !balances) return null

  // Show XLM first, then any non-native tokens
  const xlm = balances.find((b) => b.asset === 'XLM')
  const tokens = balances.filter((b) => b.asset !== 'XLM')

  return (
    <div
      className="flex items-center gap-3 text-sm font-mono"
      aria-label="Wallet balances"
      data-testid="wallet-balance-display"
    >
      {xlm && (
        <span className="text-foreground" data-testid="balance-XLM">
          {formatBalance(xlm.balance, locale)} <span className="text-muted-foreground">XLM</span>
        </span>
      )}
      {tokens.map((t) => (
        <span key={t.asset} className="text-foreground" data-testid={`balance-${assetLabel(t.asset)}`}>
          {formatBalance(t.balance, locale)} <span className="text-muted-foreground">{assetLabel(t.asset)}</span>
        </span>
      ))}
    </div>
  )
}
