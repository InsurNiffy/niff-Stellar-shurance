import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { inter, ibmPlexMono } from "@/lib/fonts";
import { OfflineBanner } from "@/components/ui/offline-banner";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // enables safe-area-inset-* on notched devices
};

export const metadata: Metadata = {
  title: "NiffyInsur - Decentralized Insurance for Stellar Network",
  description: "Parametric insurance powered by DAO governance. Get coverage for smart contract risks with transparent, community-driven claim voting on the Stellar blockchain.",
  keywords: ["DeFi insurance", "parametric insurance", "Stellar blockchain", "DAO governance", "smart contract coverage", "decentralized insurance"],
  authors: [{ name: "NiffyInsur Team" }],
  creator: "NiffyInsur",
  publisher: "NiffyInsur",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://niffyinsur.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://niffyinsur.com",
    title: "NiffyInsur - Decentralized Insurance for Stellar Network",
    description: "Parametric insurance powered by DAO governance. Get coverage for smart contract risks with transparent, community-driven claim voting.",
    siteName: "NiffyInsur",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "NiffyInsur - Decentralized Insurance",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NiffyInsur - Decentralized Insurance for Stellar Network",
    description: "Parametric insurance powered by DAO governance. Get coverage for smart contract risks with transparent, community-driven claim voting.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "your-google-verification-code",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the nonce injected by middleware.ts so Next.js inline scripts
  // (chunk loader, __NEXT_DATA__) satisfy the nonce-based CSP.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable}`}>
      <head nonce={nonce}>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider defaultTheme="system" storageKey="niffyinsur-theme">
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
