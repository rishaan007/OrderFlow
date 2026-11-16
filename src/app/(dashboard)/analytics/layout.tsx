import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analytics & Reports",
  description: "Business intelligence — revenue trends, product performance, customer retention, and payments.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
