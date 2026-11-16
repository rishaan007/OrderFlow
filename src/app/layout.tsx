import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CookieConsent } from "@/components/common/CookieConsent";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "OrderFlow — Next-Gen Social Commerce SaaS Order Management",
    template: "%s | OrderFlow",
  },
  description:
    "Centralize customer conversations, orders, multi-variant inventory, payments, and multi-carrier deliveries for Instagram & WhatsApp sellers.",
  applicationName: "OrderFlow",
  authors: [{ name: "OrderFlow Engineering Team" }],
  generator: "Next.js",
  keywords: [
    "social commerce",
    "order management",
    "instagram commerce",
    "whatsapp orders",
    "multi-tenant saas",
    "inventory management",
    "conversational commerce",
  ],
  creator: "OrderFlow",
  publisher: "OrderFlow Inc.",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [
      { url: "/icon.svg", sizes: "180x180", type: "image/svg+xml" },
    ],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: appUrl,
    siteName: "OrderFlow",
    title: "OrderFlow — Turn conversations into confirmed orders",
    description:
      "Enterprise-grade multi-tenant order management and conversational commerce platform for social sellers.",
  },
  twitter: {
    card: "summary_large_image",
    title: "OrderFlow — Turn conversations into confirmed orders",
    description:
      "Centralize Instagram & WhatsApp customer conversations, multi-variant inventory, and deliveries.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-screen bg-surface-50 text-surface-900 font-sans antialiased flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
        >
          Skip to main content
        </a>
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
