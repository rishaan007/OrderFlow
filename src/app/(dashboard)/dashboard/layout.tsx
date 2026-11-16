import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Real-time workspace overview — revenue, orders, top customers, and low-stock alerts.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
