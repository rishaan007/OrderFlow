import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create New Order",
  description: "Manually create a new order with live pricing, inventory checks, and customer assignment.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
