'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Clock, FileText, Shield } from 'lucide-react'

import { PolicyMetadataUriViewer } from '@/components/policies/PolicyMetadataUriViewer'
import { useWallet } from '@/features/wallet'
import { RenewModal } from './RenewModal'
import { TerminateModal } from './TerminateModal'
import { TransferPolicyModal } from './TransferPolicyModal'
import { ClaimCooldownBanner } from './ClaimCooldownBanner'
import { LastSyncedIndicator } from './LastSyncedIndicator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { PrintButton } from '@/components/ui/print-button'
import { getConfig } from '@/config/env'
import { PolicyDtoSchema, type PolicyDto, type ClaimSummaryDto, fetchClaimCap, type ClaimCapDto } from '../api'

interface PolicyDetailClientProps {
  initialPolicy: PolicyDto
  policyId: string
}

const LEDGER_CLOSE_SECONDS = 5
const RENEWAL_WINDOW_LEDGERS = (30 * 24 * 60 * 60) / LEDGER_CLOSE_SECONDS
const DEFAULT_GRACE_PERIOD_LEDGERS = 8640 // 72 hours (3 days) at 5s per ledger

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

function ClaimCapCard({ policyId }: { policyId: string }) {
  const { data, isLoading, isError } = useQuery<ClaimCapDto>({
    queryKey: ['policy-claim-cap', policyId],
    queryFn: ({ signal }) => fetchClaimCap(policyId, signal),
    refetchInterval: 30000,
    retry: false,
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5" />Claim Cap Usage</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-gray-500">Loading claim cap data…</p></CardContent>
      </Card>
    )
  }

  if (isError || !data) return null

  const cap = BigInt(data.rolling_cap)
  const used = BigInt(data.claimed_in_window)
  const pct = cap === 0n ? 0 : Number((used * 100n) / cap)
  const resetSeconds = data.window_ledgers_remaining * LEDGER_CLOSE_SECONDS
  const resetDays = Math.floor(resetSeconds / 86400)
  const resetHours = Math.floor((resetSeconds % 86400) / 3600)

  const barColor =
    pct >= 90 ? '#ef4444' : pct >= 70 ? '#eab308' : undefined

  const capXlm = (Number(cap) / 10_000_000).toFixed(2)
  const usedXlm = (Number(used) / 10_000_000).toFixed(2)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Rolling Claim Cap
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Claimed this window</span>
          <span className="font-mono font-medium">
            {usedXlm} / {capXlm} XLM
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct.toFixed(1)}% of rolling claim cap used`}
          className="relative h-3 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div
            className="h-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{pct.toFixed(1)}% used</span>
          <span>
            Resets in{' '}
            {resetDays > 0
              ? `${resetDays}d ${resetHours}h`
              : `${resetHours}h`}{' '}
            <span className="text-gray-400">(ledger #{data.window_reset_ledger.toLocaleString()})</span>
          </span>
        </div>
        {pct >= 90 && (
          <p className="text-xs text-red-600 font-medium" role="alert">
            Cap nearly exhausted — new claims may be rejected until the window resets.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function PolicyDetailClient({ initialPolicy, policyId }: PolicyDetailClientProps) {
  const { connectionStatus, address } = useWallet()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  
  const [renewModalOpen, setRenewModalOpen] = useState(false)
  const [terminateModalOpen, setTerminateModalOpen] = useState(false)
  const [transferModalOpen, setTransferModalOpen] = useState(false)

  const {
    data: policy = initialPolicy,
    dataUpdatedAt,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['policy', policyId],
    queryFn: () => fetchPolicy(policyId),
    initialData: initialPolicy,
    refetchInterval: 15000,
  })

  // Prefer React Query's last success time; fall back to load time for SSR initialData.
  const lastSyncedAt = dataUpdatedAt > 0 ? dataUpdatedAt : Date.now()

  const ledgersRemaining = policy.expiry_countdown?.ledgers_remaining ?? 0
  const secondsRemaining = ledgersRemaining * LEDGER_CLOSE_SECONDS
  const isInRenewalWindow = ledgersRemaining > 0 && ledgersRemaining <= RENEWAL_WINDOW_LEDGERS
  // ledgers_remaining goes negative after expiry; grace ends at -DEFAULT_GRACE_PERIOD_LEDGERS
  const isInGracePeriod = ledgersRemaining <= 0 && ledgersRemaining > -DEFAULT_GRACE_PERIOD_LEDGERS
  const graceLedgersRemaining = isInGracePeriod ? ledgersRemaining + DEFAULT_GRACE_PERIOD_LEDGERS : 0
  const graceSecondsRemaining = graceLedgersRemaining * LEDGER_CLOSE_SECONDS
  const isExpired = ledgersRemaining <= -DEFAULT_GRACE_PERIOD_LEDGERS
  const connected = connectionStatus === 'connected'
  const isHolder = connected && address === policy.holder
  const beneficiary = (policy as PolicyDto & { beneficiary?: string | null }).beneficiary ?? null

  const handleRenewSuccess = (_txHash?: string) => {
    queryClient.invalidateQueries({ queryKey: ['policy', policyId] })
    toast({ title: 'Renewal submitted', description: 'Your policy renewal has been submitted successfully.' })
    setRenewModalOpen(false)
  }

  const handleTerminateSuccess = (_txHash?: string) => {
    queryClient.invalidateQueries({ queryKey: ['policy', policyId] })
    toast({ title: 'Policy terminated', description: 'Your policy has been terminated.' })
    setTerminateModalOpen(false)
  }

  const handleTransferSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['policy', policyId] })
    toast({ title: 'Transfer submitted', description: 'Your policy transfer has been submitted successfully.' })
    setTransferModalOpen(false)
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/policies" className="text-sm text-blue-600 hover:underline">← Policies</Link>
        <div className="flex items-center gap-2">
          <PrintButton />
          <Badge variant={policy.is_active ? 'default' : 'secondary'}>{policy.is_active ? 'Active' : 'Inactive'}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Policy #{policy.policy_id}</h1>
        <LastSyncedIndicator
          syncedAt={lastSyncedAt}
          onRefresh={() => { void refetch() }}
          isRefreshing={isFetching}
        />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Coverage Summary</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="text-sm text-gray-500">Policy Type</p><p className="font-medium">{policy.policy_type}</p></div>
            <div><p className="text-sm text-gray-500">Risk Region</p><p className="font-medium">{policy.region}</p></div>
            <div><p className="text-sm text-gray-500">Coverage Amount</p><p className="font-mono">{formatStroopsToXLM(policy.coverage_summary.coverage_amount)} XLM</p></div>
            <div><p className="text-sm text-gray-500">Premium</p><p className="font-mono">{formatStroopsToXLM(policy.coverage_summary.premium_amount)} XLM/yr</p></div>
            <div><p className="text-sm text-gray-500">Holder</p><p className="font-mono text-xs truncate">{policy.holder}</p></div>
            <div><p className="text-sm text-gray-500">Beneficiary</p><p className="font-mono text-xs truncate">{beneficiary || 'Not set — payouts go to holder'}</p></div>
          </div>
          {connected && beneficiary && beneficiary !== address && (
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

      {policy.metadata_uri && (
        <PolicyMetadataUriViewer
          metadataUri={policy.metadata_uri}
          termsHash={policy.terms_hash}
        />
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" />Expiry Countdown</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isInGracePeriod ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-amber-900">Policy expired — grace period active</p>
                  <p className="text-sm text-amber-700">Renew now to avoid a coverage gap.</p>
                </div>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-700">{formatDuration(graceSecondsRemaining)}</p>
                <p className="text-sm text-gray-500">{graceLedgersRemaining.toLocaleString()} ledgers left in grace period</p>
              </div>
              <p className="text-xs text-gray-400">ⓘ Grace period ends ~{formatDuration(graceSecondsRemaining)} from now. After this window closes, you will need to purchase a new policy.</p>
            </div>
          ) : isExpired ? (
            <p className="text-lg font-semibold text-red-600">Policy expired — grace period has ended</p>
          ) : (
            <>
              <div>
                <p className="text-2xl font-bold">{formatDuration(secondsRemaining)}</p>
                <p className="text-sm text-gray-500">{ledgersRemaining.toLocaleString()} ledgers remaining</p>
              </div>
              {isInRenewalWindow && (
                <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                  <Clock className="h-4 w-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                  <p className="text-sm text-blue-800">Renewal window is open — renew before expiry to maintain continuous coverage.</p>
                </div>
              )}
              <p className="text-xs text-gray-400">ⓘ Estimated time based on 5s average ledger close time. Displayed values may lag on-chain state by up to 15 seconds.</p>
            </>
          )}
        </CardContent>
      </Card>

      <ClaimCapCard policyId={policyId} />

      {policy.claim_cooldown && policy.claim_cooldown.ledgers_remaining > 0 && (
        <ClaimCooldownBanner
          ledgersRemaining={policy.claim_cooldown.ledgers_remaining}
          estimatedSecondsRemaining={policy.claim_cooldown.estimated_seconds_remaining}
        />
      )}

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
          <Button onClick={() => setRenewModalOpen(true)} disabled={!isInRenewalWindow && !isInGracePeriod} title={!isInRenewalWindow && !isInGracePeriod ? `Renewal available in the last 30 days before expiry (${Math.max(0, ledgersRemaining - RENEWAL_WINDOW_LEDGERS)} ledgers remaining)` : undefined}>Renew Policy</Button>
          <Button variant="outline" onClick={() => setTransferModalOpen(true)}>Transfer Policy</Button>
          <Button variant="destructive" onClick={() => setTerminateModalOpen(true)}>Terminate Policy</Button>
        </div>
      )}

      {isHolder && (
        <>
          {renewModalOpen && <RenewModal policy={policy} onClose={() => setRenewModalOpen(false)} onSubmitted={handleRenewSuccess} />}
          {terminateModalOpen && <TerminateModal policy={policy} onClose={() => setTerminateModalOpen(false)} onSubmitted={handleTerminateSuccess} />}
          <TransferPolicyModal
            policy={policy}
            open={transferModalOpen}
            onOpenChange={setTransferModalOpen}
            onSuccess={handleTransferSuccess}
          />
        </>
      )}
    </main>
  )
}
