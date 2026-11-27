import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Policy {
  id: string;
  policyNumber?: string;
  holderName?: string;
  coverageType?: string;
  coverageAmount?: number;
  premiumPaid?: number;
  currency?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  renewalWindowDays?: number;
}

interface Claim {
  id: string;
  claimNumber?: string;
  status?: string;
  amount?: number;
  createdAt?: string;
  description?: string;
}

async function fetchPolicy(id: string): Promise<Policy | null> {
  try {
    const res = await fetch(`${API_BASE}/policies/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as Policy;
  } catch {
    return null;
  }
}

async function fetchClaims(id: string): Promise<Claim[]> {
  try {
    const res = await fetch(
      `${API_BASE}/claims?policyId=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as Claim[]) : ((data?.items as Claim[]) ?? []);
  } catch {
    return [];
  }
}

function formatMoney(amount?: number, currency = "USD"): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysUntil(value?: string): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function statusBadgeClass(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
    case "paid":
      return "bg-green-100 text-green-800";
    case "pending":
    case "submitted":
      return "bg-yellow-100 text-yellow-800";
    case "rejected":
    case "denied":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const policy = await fetchPolicy(params.id);
  if (!policy) {
    return { title: "Policy not found" };
  }
  const label = policy.policyNumber ?? policy.id;
  const title = `Policy ${label}${policy.coverageType ? ` — ${policy.coverageType}` : ""}`;
  const description = `Coverage summary, claim history, and renewal options for policy ${label}.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article" },
    twitter: { card: "summary", title, description },
  };
}

export default async function PolicyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [policy, claims] = await Promise.all([
    fetchPolicy(params.id),
    fetchClaims(params.id),
  ]);

  if (!policy) {
    notFound();
  }

  const remainingDays = daysUntil(policy.endDate);
  const renewalWindowDays = policy.renewalWindowDays ?? 30;
  const withinRenewalWindow =
    remainingDays != null && remainingDays >= 0 && remainingDays <= renewalWindowDays;
  const renewalTooltip = withinRenewalWindow
    ? "Renew your policy now."
    : remainingDays == null
      ? "Renewal is unavailable because the policy expiry date is unknown."
      : remainingDays < 0
        ? "This policy has expired and can no longer be renewed online."
        : `Renewal opens ${renewalWindowDays} days before expiry (in ${remainingDays - renewalWindowDays} days).`;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Policy {policy.policyNumber ?? policy.id}
          </h1>
          {policy.holderName && (
            <p className="text-sm text-gray-600">Holder: {policy.holderName}</p>
          )}
        </div>
        {policy.status && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(policy.status)}`}
          >
            {policy.status}
          </span>
        )}
      </div>

      <section className="mb-8 rounded-lg border border-gray-200 p-6">
        <h2 className="mb-4 text-lg font-semibold">Coverage summary</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-gray-500">Coverage type</dt>
            <dd className="text-base font-medium">{policy.coverageType ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Coverage amount</dt>
            <dd className="text-base font-medium">
              {formatMoney(policy.coverageAmount, policy.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Premium paid</dt>
            <dd className="text-base font-medium">
              {formatMoney(policy.premiumPaid, policy.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Policy period</dt>
            <dd className="text-base font-medium">
              {formatDate(policy.startDate)} – {formatDate(policy.endDate)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Expiry countdown</dt>
            <dd className="text-base font-medium">
              {remainingDays == null
                ? "—"
                : remainingDays < 0
                  ? `Expired ${Math.abs(remainingDays)} day(s) ago`
                  : `${remainingDays} day(s) remaining`}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold">Claim history</h2>
        {claims.length === 0 ? (
          <p className="text-sm text-gray-600">No claims filed for this policy.</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
            {claims.map((claim) => (
              <li key={claim.id} className="flex items-center justify-between p-4">
                <div>
                  <Link
                    href={`/claims/${claim.id}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {claim.claimNumber ?? claim.id}
                  </Link>
                  <p className="text-sm text-gray-500">
                    {formatDate(claim.createdAt)}
                    {claim.amount != null
                      ? ` · ${formatMoney(claim.amount, policy.currency)}`
                      : ""}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass(claim.status)}`}
                >
                  {claim.status ?? "unknown"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-4">
        <span title={renewalTooltip}>
          <button
            type="button"
            disabled={!withinRenewalWindow}
            title={renewalTooltip}
            className="rounded-md bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            Renew policy
          </button>
        </span>
        <TerminatePolicyButton policyId={policy.id} />
      </section>
    </main>
  );
}

function TerminatePolicyButton({ policyId }: { policyId: string }) {
  return (
    <form action={`/policies/${policyId}/terminate`} method="post">
      <button
        type="submit"
        className="rounded-md border border-red-600 px-4 py-2 text-red-600"
        onClick={(e) => {
          if (!window.confirm("Are you sure you want to terminate this policy? This cannot be undone.")) {
            e.preventDefault();
          }
        }}
      >
        Terminate policy
      </button>
    </form>
  );
}
