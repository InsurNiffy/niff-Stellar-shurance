import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://niffyinsure.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "niffyInsure — Decentralized insurance on Stellar",
    template: "%s | niffyInsure",
  },
  description:
    "niffyInsure is decentralized insurance on Stellar. Buy coverage, file claims, and let policyholders vote on payouts — transparent, fast, and on-chain.",
  keywords: [
    "niffyInsure",
    "decentralized insurance",
    "Stellar",
    "on-chain insurance",
    "claims voting",
    "crypto insurance",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "niffyInsure",
    title: "niffyInsure — Decentralized insurance on Stellar",
    description:
      "Buy coverage, file claims, and let policyholders vote on payouts. Transparent, fast, and on-chain.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "niffyInsure — Decentralized insurance on Stellar",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "niffyInsure — Decentralized insurance on Stellar",
    description:
      "Buy coverage, file claims, and let policyholders vote on payouts. Transparent, fast, and on-chain.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
