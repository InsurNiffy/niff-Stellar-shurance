'use client'

import { Info, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/utils'

export function VoteEducationPanel() {
  const [open, setOpen] = useState(false)

  return (
    <aside
      className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
      aria-label="How claim voting works"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between font-semibold"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="vote-edu-body"
      >
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          How claim voting works
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
      </button>

      <div
        id="vote-edu-body"
        className={cn('mt-3 space-y-2 leading-relaxed', !open && 'hidden')}
      >
        <p>
          <strong>Who can vote?</strong> Only wallets that held an active policy
          at the time the claim was filed are eligible. Eligibility is determined
          by the on-chain voter snapshot taken when the claim was submitted — it
          cannot be changed after filing.
        </p>
        <p>
          <strong>What does Approve mean?</strong> You are indicating that, based
          on the claim details and supporting evidence provided, the claim appears
          valid under the policy terms. An approved claim becomes eligible for
          payout processing.
        </p>
        <p>
          <strong>What does Reject mean?</strong> You are indicating that the
          claim does not appear to meet the policy conditions. A rejected claim
          results in no payout and the associated policy is deactivated.
        </p>
        <p>
          <strong>How is the outcome decided?</strong> The contract uses a{' '}
          <strong>participation quorum</strong> plus <strong>plurality</strong>{' '}
          among ballots actually cast. Let <em>E</em> be the number of eligible
          voters in the snapshot, <em>C</em> = approve votes + reject votes, and{' '}
          <em>Q</em> be this claim&apos;s quorum in basis points (1–10,000), fixed
          when the claim was filed. Required cast ballots are{' '}
          <code className="rounded bg-blue-200/60 px-1">R = ⌈E × Q ÷ 10,000⌉</code>
          . The vote is valid only if <em>C ≥ R</em>. Then: if approve votes exceed
          reject votes the claim is approved; otherwise it is rejected (including
          ties). If the deadline passes with <em>C &lt; R</em>, the claim is
          rejected for insufficient participation. Admin can adjust <em>Q</em> for
          new claims only; it does not change mid-flight for claims already open.
        </p>
        <p>
          <strong>Voting deadline.</strong> Votes are accepted for approximately
          7 days after the claim is filed (120,960 ledgers at ~5 s per ledger).
          After the deadline, no further votes can be cast.
        </p>
        <p>
          <strong>Your vote is final.</strong> Once submitted and confirmed
          on-chain, votes cannot be changed or retracted.
        </p>
        <p>
          <strong>Claimant withdrawal.</strong> Before any vote is cast, the
          claimant can withdraw the claim on-chain. After the first vote,
          withdrawal is disabled. Withdrawn claims stay visible for audit and
          do not receive payout.
        </p>
        <p>
          <strong>No governance token.</strong> Voting power comes solely from
          holding an active policy — there is no separate token to buy or stake.
        </p>
        <p className="rounded border border-blue-300 bg-blue-100 px-3 py-2 text-xs">
          This interface is informational only. It does not constitute financial,
          legal, or insurance advice. Review the full policy terms before voting.
        </p>
      </div>
    </aside>
  )
}
