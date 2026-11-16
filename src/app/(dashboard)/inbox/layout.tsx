import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Unified Inbox",
  description: "Manage WhatsApp and Instagram conversations, extract order details, and convert chats to orders.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
