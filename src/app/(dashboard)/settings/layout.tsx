import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings",
  description: "Configure your workspace profile, team members, subscription plan, and integration settings.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
