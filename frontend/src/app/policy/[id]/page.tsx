'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/use-wallet';
import { getConfig } from '@/config/env';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { formatTokenAmount } from '@/lib/formatTokenAmount';

const { apiUrl: API_BASE_URL } = getConfig();

/** Shape of GET /policies/:holder/:policy_id (Express indexer API). */
interface PolicyDetailResponse {
  holder: string;
  policy_id: number;
  policy_type: string;
  region: string;
  is_active: boolean;
  beneficiary: string | null;
  coverage_summary: {
    coverage_amount: string;
    premium_amount: string;
    currency: string;
    decimals: number;
  };
  expiry_countdown: {
    start_ledger: number;
    end_ledger: number;
    ledgers_remaining: number;
    avg_ledger_close_seconds: number;
  };
  claims: unknown[];
  _link: string;
}

export default function PolicyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { address: connectedAddress, connected } = useWallet();
  const policyIdParam = params.id as string;
  const policyId = parseInt(policyIdParam, 10);

  const [policy, setPolicy] = useState<PolicyDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connected || !connectedAddress) {
      setLoading(false);
      setError('Connect your wallet to view this policy.');
      return;
    }
    if (!Number.isInteger(policyId) || policyId < 1) {
      setLoading(false);
      setError('Invalid policy ID.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const url = `${API_BASE_URL}/policies/${encodeURIComponent(connectedAddress)}/${policyId}`;
        const res = await fetch(url);
        if (res.status === 404) {
          if (!cancelled) {
            setPolicy(null);
            setError('Policy not found for your wallet and this policy ID.');
          }
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? `Request failed (${res.status})`);
        }
        const data = (await res.json()) as PolicyDetailResponse;
        if (!cancelled) {
          setPolicy(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setPolicy(null);
          setError(e instanceof Error ? e.message : 'Failed to load policy.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, connectedAddress, policyId]);

  const payoutAddress = policy?.beneficiary?.trim() || policy?.holder;
  const showBeneficiaryMismatch =
    Boolean(
      connectedAddress &&
        policy?.beneficiary &&
        policy.beneficiary !== connectedAddress,
    );

  if (loading) {
    return (
      <div className="container max-w-3xl py-10 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="container max-w-3xl py-16">
        <Card className="border-destructive/40">
          <CardContent className="pt-6 space-y-4">
            <p className="text-muted-foreground">{error ?? 'Policy unavailable.'}</p>
            <Button variant="outline" onClick={() => router.push('/policy')}>
              Back to policies
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-10 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="h-9 w-9 shrink-0" aria-label="Go back">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Policy #{policy.policy_id}</h1>
      </div>

      {showBeneficiaryMismatch ? (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-900 dark:text-amber-100">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              Payout address differs from your wallet
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              Approved claims pay the <strong className="text-foreground">beneficiary</strong> below, not
              necessarily the wallet you are connected with. Confirm this address matches what you intend
              (cold wallet, multisig, estate, etc.).
            </p>
            <p>
              <strong className="text-foreground">Phishing risk:</strong> malicious sites can trick you into
              setting a beneficiary you do not control. Always verify the address on a second channel before
              signing policy changes.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coverage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Holder</p>
              <p className="font-mono text-xs break-all">{policy.holder}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Type / region</p>
              <p>
                {policy.policy_type} · {policy.region}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Coverage</p>
              <p className="font-mono">
                {formatTokenAmount(policy.coverage_summary.coverage_amount, policy.coverage_summary.decimals)} {policy.coverage_summary.currency}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Premium</p>
              <p className="font-mono">
                {formatTokenAmount(policy.coverage_summary.premium_amount, policy.coverage_summary.decimals)} {policy.coverage_summary.currency}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Payout beneficiary</p>
              <p className="font-mono text-xs break-all">
                {policy.beneficiary ?? (
                  <span className="text-muted-foreground italic">Not set — payouts go to holder</span>
                )}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-muted-foreground">Effective payout destination</p>
              <p className="font-mono text-xs break-all">{payoutAddress}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="default" onClick={() => router.push(`/policy/${policyIdParam}/claim`)}>
              File a claim
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
