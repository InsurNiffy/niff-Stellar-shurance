import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Announcements — NiffyInsur",
  description: "Read product updates and important account notices from NiffyInsur.",
};

export default function AnnouncementsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
