import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Verified Social Transaction | OrderFlow",
  description: "View verified social transaction details, live shipment tracking, payment verification, and order timeline.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function TransactionRoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-surface-50 antialiased">{children}</div>;
}
