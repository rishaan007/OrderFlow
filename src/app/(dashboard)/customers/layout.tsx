import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Customers",
  description: "View and manage your customer directory, contact info, order history, and lifetime value.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
