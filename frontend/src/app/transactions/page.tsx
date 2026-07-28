'use client'

import { useWallet } from '@/hooks/use-wallet'
import { HorizonTransactionList } from '@/components/transactions/horizon-transaction-list'
import { WalletConnectButton } from '@/features/wallet'
import { useTransactionFilters } from '@/lib/hooks/useTransactionFilters'

export default function TransactionsPage() {
  const { address } = useWallet()
  const [filters, setFilters] = useTransactionFilters()

  return (
    <main className="container mx-auto px-4 py-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Transaction History</h1>
      <p className="text-sm text-muted-foreground mb-6">
        On-chain operations for your wallet, enriched with contract event descriptions when available.
      </p>

      {!address ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-gray-500">Connect your wallet to load transactions.</p>
          <WalletConnectButton />
        </div>
      ) : (
        <HorizonTransactionList account={address} filters={filters} onFiltersChange={setFilters} />
      )}
    </main>
  )
}
