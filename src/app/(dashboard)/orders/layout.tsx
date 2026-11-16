import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Orders",
  description: "Manage, filter, and track all confirmed, pending, and shipped customer orders.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
