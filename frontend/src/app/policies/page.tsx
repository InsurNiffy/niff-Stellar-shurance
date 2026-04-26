'use client'

import { useWallet } from '@/hooks/use-wallet'
import { PolicyDashboard } from '@/features/policies/components/PolicyDashboard'
import { WalletConnectButton } from '@/features/wallet'

export default function PoliciesPage() {
  const { address } = useWallet()

  if (!address) {
    return (
      <main className="container mx-auto px-4 py-16 max-w-6xl flex flex-col items-center gap-6 text-center">
        <span className="text-5xl" aria-hidden="true">🔒</span>
        <h1 className="text-2xl font-bold text-gray-900">Connect your wallet</h1>
        <p className="text-gray-500 max-w-sm">
          Connect your Stellar wallet to view and manage your insurance policies.
        </p>
        <WalletConnectButton />
      </main>
    )
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Policies</h1>
      <PolicyDashboard />
    </main>
  )
}
