import type { ReactNode } from "react";
import Header from "@/components/nav/Header";
import Footer from "@/components/nav/Footer";
import NetworkStatusIndicator from "@/components/nav/NetworkStatusIndicator";
import ClientObservability from "@/components/observability/ClientObservability";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to content
      </a>
      <Header />
      <NetworkStatusIndicator />
      <main
        id="main-content"
        tabIndex={-1}
        aria-label="Main content"
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 focus:outline-none"
      >
        {children}
      </main>
      <Footer />
      <ClientObservability />
    </div>
  );
}
