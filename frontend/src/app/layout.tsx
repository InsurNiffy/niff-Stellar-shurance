import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { inter, ibmPlexMono } from "@/lib/fonts";

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

import { ThemeProvider } from "@/components/theme-provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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
