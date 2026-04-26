'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Clock, FileText, Shield } from 'lucide-react'

import { useWallet } from '@/features/wallet'
import { RenewModal } from './RenewModal'
import { TerminateModal } from './TerminateModal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { getConfig } from '@/config/env'
import { PolicyDtoSchema, type PolicyDto, type ClaimSummaryDto } from '../api'

interface PolicyDetailClientProps {
  initialPolicy: PolicyDto
  policyId: string
}

const LEDGER_CLOSE_SECONDS = 5
const RENEWAL_WINDOW_LEDGERS = 30 * 24 * 60 * 60 / LEDGER_CLOSE_SECONDS

function formatStroopsToXLM(stroops: string): string {
  const num = BigInt(stroops)
  const xlm = Number(num) / 10_000_000
  return xlm.toFixed(7)
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'approved': return 'bg-green-100 text-green-800'
    case 'rejected': return 'bg-red-100 text-red-800'
    case 'processing': return 'bg-yellow-100 text-yellow-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

async function fetchPolicy(policyId: string): Promise<PolicyDto> {
  const { apiUrl } = getConfig()
  const res = await fetch(`${apiUrl}/api/policies/${policyId}`)
  if (!res.ok) throw new Error('Failed to fetch policy')
  const data = await res.json()
  const parsed = PolicyDtoSchema.safeParse(data)
  if (!parsed.success) throw new Error('Invalid policy data')
  return parsed.data
}

export function PolicyDetailClient({ initialPolicy, policyId }: PolicyDetailClientProps) {
  const { connected, address } = useWallet()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const [renewModalOpen, setRenewModalOpen] = useState(false)
  const [terminateModalOpen, setTerminateModalOpen] = useState(false)

  const { data: policy = initialPolicy } = useQuery({
    queryKey: ['policy', policyId],
    queryFn: () => fetchPolicy(policyId),
    initialData: initialPolicy,
    refetchInterval: 15000,
  })

  const ledgersRemaining = policy.expiry_countdown?.ledgers_remaining ?? 0
  const secondsRemaining = ledgersRemaining * LEDGER_CLOSE_SECONDS
  const isInRenewalWindow = ledgersRemaining > 0 && ledgersRemaining <= RENEWAL_WINDOW_LEDGERS
  const isExpired = ledgersRemaining <= 0
  const isHolder = connected && address === policy.holder

  const handleRenewSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['policy', policyId] })
    toast({ title: 'Renewal submitted', description: 'Your policy renewal has been submitted successfully.' })
    setRenewModalOpen(false)
  }

  const handleTerminateSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['policy', policyId] })
    toast({ title: 'Policy terminated', description: 'Your policy has been terminated.' })
    setTerminateModalOpen(false)
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/policies" className="text-sm text-blue-600 hover:underline">← Policies</Link>
        <Badge variant={policy.is_active ? 'default' : 'secondary'}>{policy.is_active ? 'Active' : 'Inactive'}</Badge>
      </div>

      <h1 className="text-3xl font-bold">Policy #{policy.policy_id}</h1>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Coverage Summary</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="text-sm text-gray-500">Policy Type</p><p className="font-medium">{policy.policy_type}</p></div>
            <div><p className="text-sm text-gray-500">Risk Region</p><p className="font-medium">{policy.region}</p></div>
            <div><p className="text-sm text-gray-500">Coverage Amount</p><p className="font-mono">{formatStroopsToXLM(policy.coverage_summary.coverage_amount)} XLM</p></div>
            <div><p className="text-sm text-gray-500">Premium</p><p className="font-mono">{formatStroopsToXLM(policy.coverage_summary.premium_amount)} XLM/yr</p></div>
            <div><p className="text-sm text-gray-500">Holder</p><p className="font-mono text-xs truncate">{policy.holder}</p></div>
            <div><p className="text-sm text-gray-500">Beneficiary</p><p className="font-mono text-xs truncate">{policy.beneficiary || 'Not set — payouts go to holder'}</p></div>
          </div>
          {connected && policy.beneficiary && policy.beneficiary !== address && (
            <div className="flex gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-900">Payout destination differs from connected wallet</p>
                <p className="text-yellow-700 mt-1">Claim payouts will go to the beneficiary address, not your connected wallet. Verify this is intentional to avoid phishing attacks.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" />Expiry Countdown</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isExpired ? (
            <p className="text-lg font-semibold text-red-600">Policy expired</p>
          ) : (
            <>
              <div>
                <p className="text-2xl font-bold">{formatDuration(secondsRemaining)}</p>
                <p className="text-sm text-gray-500">{ledgersRemaining.toLocaleString()} ledgers remaining</p>
              </div>
              <p className="text-xs text-gray-400">ⓘ Estimated time based on 5s average ledger close time. Displayed values may lag on-chain state by up to 15 seconds.</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Linked Claims</CardTitle></CardHeader>
        <CardContent>
          {policy.claims && policy.claims.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="sticky left-0 bg-white py-2 pr-4 font-semibold">Claim ID</th>
                    <th className="py-2 px-4 font-semibold">Amount</th>
                    <th className="py-2 px-4 font-semibold">Status</th>
                    <th className="py-2 px-4 font-semibold">Votes</th>
                    <th className="py-2 px-4 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {policy.claims.map((claim: ClaimSummaryDto) => (
                    <tr key={claim.claim_id} className="border-b last:border-0">
                      <td className="sticky left-0 bg-white py-3 pr-4 font-mono">{claim.claim_id}</td>
                      <td className="py-3 px-4 font-mono">{formatStroopsToXLM(claim.amount)} XLM</td>
                      <td className="py-3 px-4"><Badge className={getStatusColor(claim.status)}>{claim.status}</Badge></td>
                      <td className="py-3 px-4"><span className="text-green-600">{claim.approve_votes}</span> / <span className="text-red-600">{claim.reject_votes}</span></td>
                      <td className="py-3 px-4"><Link href={claim._link || `/claims/${claim.claim_id}`} className="text-blue-600 hover:underline text-sm">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4">No claims filed for this policy.</p>
          )}
        </CardContent>
      </Card>

      {isHolder && policy.is_active && (
        <div className="flex gap-3 flex-wrap">
          <Button onClick={() => setRenewModalOpen(true)} disabled={!isInRenewalWindow} title={!isInRenewalWindow ? `Renewal available in the last 30 days before expiry (${Math.max(0, ledgersRemaining - RENEWAL_WINDOW_LEDGERS)} ledgers remaining)` : undefined}>Renew Policy</Button>
          <Button variant="destructive" onClick={() => setTerminateModalOpen(true)}>Terminate Policy</Button>
        </div>
      )}

      {isHolder && (
        <>
          <RenewModal open={renewModalOpen} onOpenChange={setRenewModalOpen} policy={policy} onSuccess={handleRenewSuccess} />
          <TerminateModal open={terminateModalOpen} onOpenChange={setTerminateModalOpen} policy={policy} onSuccess={handleTerminateSuccess} />
        </>
      )}
    </main>
  )
}
