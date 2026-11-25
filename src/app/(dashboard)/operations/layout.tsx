import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Commerce Operations",
  description:
    "Manage payment intents, fulfillment & tracking, returns, refunds, financial ledger, and reconciliation.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
