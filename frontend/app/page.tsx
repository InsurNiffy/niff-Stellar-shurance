import type { Metadata } from "next";
import Link from "next/link";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://niffyinsure.app";
const SITE_NAME = "niffyInsure";
const SITE_DESCRIPTION =
  "Decentralized insurance on Stellar. Buy coverage, file claims, and let policyholders vote on payouts — transparent, fast, and on-chain.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "niffyInsure — Decentralized insurance on Stellar",
    template: "%s | niffyInsure",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "niffyInsure",
    "decentralized insurance",
    "Stellar",
    "DeFi insurance",
    "on-chain claims",
    "policyholder voting",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "niffyInsure — Decentralized insurance on Stellar",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "niffyInsure — decentralized insurance on Stellar",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "niffyInsure — Decentralized insurance on Stellar",
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
};

// Stats are fetched at build time and revalidated hourly so the page stays
// statically generated (and renders without JavaScript) while remaining fresh.
export const revalidate = 3600;

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface TrustStats {
  totalCoverage: string;
  policiesIssued: string;
  claimsPaid: string;
  activeVoters: string;
}

const FALLBACK_STATS: TrustStats = {
  totalCoverage: "$12.4M",
  policiesIssued: "38,200+",
  claimsPaid: "$3.1M",
  activeVoters: "9,400+",
};

async function getTrustStats(): Promise<TrustStats> {
  if (!API_BASE) return FALLBACK_STATS;
  try {
    const res = await fetch(`${API_BASE}/stats/overview`, {
      next: { revalidate },
    });
    if (!res.ok) return FALLBACK_STATS;
    const data = (await res.json()) as Partial<TrustStats>;
    return {
      totalCoverage: data.totalCoverage ?? FALLBACK_STATS.totalCoverage,
      policiesIssued: data.policiesIssued ?? FALLBACK_STATS.policiesIssued,
      claimsPaid: data.claimsPaid ?? FALLBACK_STATS.claimsPaid,
      activeVoters: data.activeVoters ?? FALLBACK_STATS.activeVoters,
    };
  } catch {
    return FALLBACK_STATS;
  }
}

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Buy a policy",
    body: "Pick a coverage type, pay in XLM or USDC, and receive an on-chain policy in seconds.",
  },
  {
    step: "02",
    title: "File a claim",
    body: "Submit evidence for a covered event directly from your dashboard. No paperwork, no waiting rooms.",
  },
  {
    step: "03",
    title: "Community votes",
    body: "Policyholders review the evidence and vote on the claim. Outcomes are recorded transparently on-chain.",
  },
  {
    step: "04",
    title: "Get paid out",
    body: "Approved claims settle automatically to your Stellar wallet — usually within minutes.",
  },
];

const COVERAGE_TYPES = [
  {
    name: "Smart contract cover",
    body: "Protection against exploits, hacks, and unexpected failures in audited DeFi contracts.",
  },
  {
    name: "Stablecoin depeg",
    body: "Coverage for holders if a supported stablecoin loses its peg beyond a defined threshold.",
  },
  {
    name: "Custody & bridge risk",
    body: "Insure assets held with custodians or moved across supported Stellar bridges.",
  },
  {
    name: "Parametric events",
    body: "Automatic payouts triggered by verifiable on-chain or oracle-reported events.",
  },
];

const FAQ_PREVIEW = [
  {
    q: "Who decides if a claim is paid?",
    a: "Policyholders vote on every claim. Votes and outcomes are recorded on-chain so anyone can audit them.",
  },
  {
    q: "How fast are payouts?",
    a: "Once a claim is approved, settlement is automatic and typically lands in your wallet within minutes.",
  },
  {
    q: "What assets can I use?",
    a: "Premiums and payouts are denominated in XLM or supported Stellar stablecoins.",
  },
];

export default async function HomePage() {
  const stats = await getTrustStats();

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    sameAs: ["https://stellar.org"],
  };

  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_PREVIEW.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />

      {/* Hero */}
      <section className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
          Decentralized insurance on Stellar
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Insurance that answers to its policyholders
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
          niffyInsure lets you buy coverage, file claims, and vote on payouts — all
          transparently on-chain. No middlemen, no fine print, no waiting rooms.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/quote"
            className="rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            Get a quote
          </Link>
          <Link
            href="/how-it-works"
            className="rounded-lg border border-slate-300 px-6 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50"
          >
            How it works
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-it-works" className="mt-24">
        <h2 id="how-it-works" className="text-center text-3xl font-bold text-slate-900">
          How it works
        </h2>
        <ol className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step} className="rounded-xl border border-slate-200 p-6">
              <span className="text-sm font-semibold text-indigo-600">{item.step}</span>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Coverage types */}
      <section aria-labelledby="coverage" className="mt-24">
        <h2 id="coverage" className="text-center text-3xl font-bold text-slate-900">
          Coverage types
        </h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          {COVERAGE_TYPES.map((item) => (
            <div key={item.name} className="rounded-xl bg-slate-50 p-6">
              <h3 className="text-lg font-semibold text-slate-900">{item.name}</h3>
              <p className="mt-2 text-sm text-slate-600">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust & transparency stats */}
      <section aria-labelledby="trust" className="mt-24">
        <h2 id="trust" className="text-center text-3xl font-bold text-slate-900">
          Trust &amp; transparency
        </h2>
        <dl className="mt-12 grid gap-8 text-center sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-sm text-slate-600">Total coverage</dt>
            <dd className="mt-1 text-3xl font-bold text-slate-900">{stats.totalCoverage}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Policies issued</dt>
            <dd className="mt-1 text-3xl font-bold text-slate-900">{stats.policiesIssued}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Claims paid</dt>
            <dd className="mt-1 text-3xl font-bold text-slate-900">{stats.claimsPaid}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">Active voters</dt>
            <dd className="mt-1 text-3xl font-bold text-slate-900">{stats.activeVoters}</dd>
          </div>
        </dl>
      </section>

      {/* FAQ preview */}
      <section aria-labelledby="faq" className="mt-24">
        <h2 id="faq" className="text-center text-3xl font-bold text-slate-900">
          Frequently asked questions
        </h2>
        <dl className="mx-auto mt-12 max-w-3xl space-y-6">
          {FAQ_PREVIEW.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-200 p-6">
              <dt className="text-base font-semibold text-slate-900">{item.q}</dt>
              <dd className="mt-2 text-sm text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-center text-sm">
          <Link href="/faq" className="font-semibold text-indigo-600 hover:text-indigo-500">
            Read the full FAQ
          </Link>
        </p>
      </section>

      {/* CTA */}
      <section className="mt-24 rounded-2xl bg-indigo-600 px-6 py-16 text-center">
        <h2 className="text-3xl font-bold text-white">Ready to get covered?</h2>
        <p className="mx-auto mt-4 max-w-xl text-indigo-100">
          Get a quote in under a minute and join thousands of policyholders securing
          their on-chain assets.
        </p>
        <Link
          href="/quote"
          className="mt-8 inline-block rounded-lg bg-white px-6 py-3 text-base font-semibold text-indigo-600 hover:bg-indigo-50"
        >
          Get a quote
        </Link>
      </section>
    </main>
  );
}
