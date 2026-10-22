import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support — NiffyInsur",
  description: "Get help with NiffyInsur. Browse FAQs or contact our support team.",
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
