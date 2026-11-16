import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Log in to your OrderFlow merchant workspace to manage orders, inventory, and conversations.",
  robots: { index: true, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
