import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Products & Inventory",
  description: "Manage your multi-variant product catalog, track stock levels, and set low-stock alerts.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
