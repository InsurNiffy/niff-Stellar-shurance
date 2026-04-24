import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPolicy } from '@/lib/api/chain';
import { formatXlm } from '@/features/policies/components/PolicyItem';
import { SECS_PER_LEDGER } from '@/lib/schemas/vote';

interface Props {
  params: Promise<{ holder: string; policyId: string }>;
}

export default async function PolicyDetailPage({ params }: Props) {
  const { holder, policyId } = await params;
  const id = parseInt(policyId, 10);
  if (isNaN(id)) notFound();

  const policy = await getPolicy(decodeURIComponent(holder), id).catch(() => null);
  if (!policy) notFound();

  // policy is Record<string, unknown> from chain read — cast to known shape
  const p = policy as {
    policy_id: number;
    policy_type: string;
    region: string;
    is_active: boolean;
    coverage: string;
    premium: string;
    start_ledger: number;
    end_ledger: number;
    strike_count: number;
    /** Optional beneficiary address set by the holder. Null/undefined = payouts go to holder. */
    beneficiary?: string | null;
  };

  const statusLabel = p.is_active ? 'Active' : 'Inactive';
  const decodedHolder = decodeURIComponent(holder);
  const hasBeneficiary = Boolean(p.beneficiary?.trim());
  // Warn when a beneficiary is set — the connected wallet is server-rendered so
  // we always show the warning when any beneficiary is present; the client-side
  // policy/[id]/page.tsx compares against the live wallet address.
  const showBeneficiaryWarning = hasBeneficiary && p.beneficiary !== decodedHolder;

  return (
    <main className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-gray-500">
        <Link href="/dashboard" className="hover:underline text-blue-600">My Policies</Link>
        {' / '}
        <span>Policy #{p.policy_id}</span>
      </nav>

      {showBeneficiaryWarning && (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-amber-400/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-base">⚠️</span>
          <div className="space-y-1">
            <p className="font-semibold">Payout address differs from the policy holder</p>
            <p>
              Approved claims will be paid to the <strong>beneficiary</strong> address below, not
              the holder. Verify this address on a second channel (hardware wallet screen, multisig
              quorum, etc.) before signing any policy changes.
            </p>
            <p className="text-xs opacity-80">
              Phishing risk: malicious interfaces can trick you into setting a beneficiary you do
              not control.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Policy #{p.policy_id}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${p.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
            {statusLabel}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Detail label="Type" value={p.policy_type} />
          <Detail label="Region" value={p.region} />
          <Detail label="Coverage" value={`${formatXlm(p.coverage)} XLM`} />
          <Detail label="Premium / yr" value={`${formatXlm(p.premium)} XLM`} />
          <Detail label="Start ledger" value={String(p.start_ledger)} />
          <Detail label="End ledger" value={String(p.end_ledger)} />
          <Detail label="Strike count" value={String(p.strike_count)} />
          <div className="col-span-2">
            <dt className="text-xs text-gray-500">Payout beneficiary</dt>
            <dd className="font-mono text-xs break-all text-gray-900">
              {hasBeneficiary ? (
                <span className={showBeneficiaryWarning ? 'text-amber-700 dark:text-amber-300' : undefined}>
                  {p.beneficiary}
                </span>
              ) : (
                <span className="italic text-gray-400">Not set — payouts go to holder</span>
              )}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-gray-400">
          ⓘ This data is read directly from the Soroban ledger (no indexer lag).
          Amounts are in XLM (7 decimal places). Ledger timing: ~{SECS_PER_LEDGER}s per ledger.
        </p>
      </div>

      <Link
        href={`/policy/${encodeURIComponent(holder)}/${policyId}/claim`}
        className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
      >
        File a claim
      </Link>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900 tabular-nums">{value}</dd>
    </div>
  );
}
