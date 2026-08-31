import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import "./globals.css";
import { AnalyticsScript } from "@/components/analytics-script";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { WalletProvider, NetworkMismatchModal } from "@/features/wallet";
import { inter, ibmPlexMono } from "@/lib/fonts";
import { QueryProvider } from "@/lib/query";
import { BottomTabBar } from "@/components/nav/BottomTabBar";
import { SiteHeader } from "@/components/nav/SiteHeader";
import { NetworkBanner } from "@/components/ui/network-banner";
import { OnboardingTour } from "@/components/OnboardingTour";
import { SessionTimeoutModal } from "@/components/SessionTimeoutModal";

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
  manifest: "/site.webmanifest",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
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
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable}`} suppressHydrationWarning>
      <head nonce={nonce}>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var storageKey = 'niffyinsur-theme';
                  var theme = localStorage.getItem(storageKey);
                  var resolved = theme;
                  if (theme === 'system' || theme === null) {
                    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  }
                  document.documentElement.classList.add(resolved);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased pb-16 md:pb-0">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none"
        >
          Skip to main content
        </a>
        <ThemeProvider defaultTheme="system" storageKey="niffyinsur-theme">
          <QueryProvider>
            <WalletProvider>
              <NetworkBanner />
              <SiteHeader />
              <main id="main-content" tabIndex={-1}>
                {children}
              </main>
              <OnboardingTour />
              <SessionTimeoutModal />
              <CookieConsentBanner />
              <NetworkMismatchModal />
              <Toaster />
              <BottomTabBar />
            </WalletProvider>
          </QueryProvider>
        </ThemeProvider>
        <AnalyticsScript nonce={nonce} />
      </body>
    </html>
  );
}
