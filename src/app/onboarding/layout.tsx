import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set Up Your Workspace",
  description: "Create your business workspace — configure your store name, currency, and social settings.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
