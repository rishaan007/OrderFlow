import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrderFlow | SaaS Order Management for Small Businesses",
  description:
    "Centralize customer conversations, orders, inventory, payments, and deliveries for Instagram & WhatsApp sellers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface-50 text-surface-900 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
