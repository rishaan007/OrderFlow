import Link from "next/link";
import { ArrowLeft, Shield, Lock, Database, Eye, FileText, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Learn how OrderFlow collects, processes, protects, and retains merchant and customer data across our multi-tenant platform.",
  openGraph: {
    title: "OrderFlow Privacy Policy",
    description: "Learn how OrderFlow collects, processes, and protects your merchant and customer data.",
  },
};

export default function PrivacyPolicyPage() {
  const lastUpdated = "November 16, 2026";

  return (
    <div className="flex min-h-screen flex-col bg-white text-surface-900">
      {/* Navbar */}
      <header className="border-b border-surface-200 bg-white sticky top-0 z-20">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-lg shadow-sm">
              O
            </div>
            <span className="text-xl font-bold tracking-tight text-surface-900">
              OrderFlow
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-surface-600 hover:text-surface-900"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Home</span>
          </Link>
        </div>
      </header>

      {/* Hero / Header */}
      <main className="flex-1 py-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full">
        <div className="border-b border-surface-200 pb-8 mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 mb-4">
            <Shield className="h-3.5 w-3.5" />
            Operational Data & Compliance
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-surface-950">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-surface-500">
            Last Updated: <time dateTime="2026-11-16">{lastUpdated}</time> • Effective immediately for all OrderFlow workspaces
          </p>
        </div>

        {/* Legal Disclaimer Box */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 mb-8 text-xs text-amber-900 leading-relaxed">
          <strong>Notice for Merchants & Business Owners:</strong> This document outlines the real operational data collection and storage practices of the OrderFlow SaaS platform. Depending on your business jurisdiction (such as the EU GDPR, UK GDPR, California CCPA/CPRA, or Indian DPDP Act), you may have distinct obligations to your direct buyers. Merchants are advised to review these practices with qualified legal counsel when drafting buyer-facing terms.
        </div>

        {/* Sections */}
        <div className="space-y-10 text-sm leading-relaxed text-surface-700">
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">1</span>
              Platform Architecture & Roles
            </h2>
            <p>
              OrderFlow is a multi-tenant B2B Software-as-a-Service (SaaS) order management and conversational commerce platform. When you register a business workspace, you act as the <strong>Data Controller</strong> with respect to your end-customers&apos; personal details, customer conversations, and order transactions. OrderFlow acts as the <strong>Data Processor</strong>, storing and managing this data strictly on your behalf under cryptographic tenant isolation.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">2</span>
              Information We Collect & Process
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
              <div className="rounded-lg border border-surface-200 p-4 bg-surface-50/50">
                <h3 className="font-semibold text-surface-900 mb-1">A. Merchant Account Information</h3>
                <ul className="list-disc list-inside space-y-1 text-xs text-surface-600">
                  <li>Full name, business name, and email address</li>
                  <li>Cryptographically salted password hashes (bcrypt)</li>
                  <li>Workspace settings, store currency, timezone, and bank reconciliation details</li>
                  <li>Team member emails, role assignments, and audit records</li>
                </ul>
              </div>

              <div className="rounded-lg border border-surface-200 p-4 bg-surface-50/50">
                <h3 className="font-semibold text-surface-900 mb-1">B. Customer & Commerce Records</h3>
                <ul className="list-disc list-inside space-y-1 text-xs text-surface-600">
                  <li>Buyer contact info (name, phone, delivery address, Instagram handle)</li>
                  <li>Order details (items, SKUs, pricing, tax, shipping fees, notes)</li>
                  <li>Payment records (method, UPI transaction IDs, verification status)</li>
                  <li>Shipment tracking numbers and carrier dispatch records</li>
                </ul>
              </div>

              <div className="rounded-lg border border-surface-200 p-4 bg-surface-50/50">
                <h3 className="font-semibold text-surface-900 mb-1">C. Conversational Data</h3>
                <ul className="list-disc list-inside space-y-1 text-xs text-surface-600">
                  <li>Chat messages ingested from Meta Platforms (WhatsApp Business API & Instagram Graph API)</li>
                  <li>Thread resolution states and AI-assisted order extraction drafts</li>
                  <li>Seller approval records and customer communication timestamps</li>
                </ul>
              </div>

              <div className="rounded-lg border border-surface-200 p-4 bg-surface-50/50">
                <h3 className="font-semibold text-surface-900 mb-1">D. Technical & Security Telemetry</h3>
                <ul className="list-disc list-inside space-y-1 text-xs text-surface-600">
                  <li>Session authentication tokens (HTTP-only JWT cookies)</li>
                  <li>IP addresses for sliding-window rate limiting and abuse prevention</li>
                  <li>Structured diagnostic logs (sensitive credentials and payment card info scrubbed)</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">3</span>
              How Your Data Is Used
            </h2>
            <p>We process workspace data solely to provide, secure, and maintain the OrderFlow service, specifically to:</p>
            <ul className="list-disc list-inside space-y-1.5 pl-2 text-surface-700">
              <li>Facilitate conversational commerce workflows and transform direct messages into confirmed orders.</li>
              <li>Atomically synchronize catalog inventory and prevent stock overselling across multi-variant SKUs.</li>
              <li>Reconcile payment records and track outstanding customer balances.</li>
              <li>Enforce subscription tier quotas (e.g. monthly order volume and team seats).</li>
              <li>Provide real-time SQL business intelligence and RFC-4180 CSV reporting to workspace owners.</li>
              <li>Detect and prevent unauthorized access, brute-force attacks, and API abuse.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">4</span>
              Multi-Tenant Data Isolation & Security
            </h2>
            <p>
              OrderFlow employs database-level tenant isolation. Every business query verifies workspace membership via <code className="bg-surface-100 px-1 py-0.5 rounded text-xs font-mono">assertBusinessAccess</code> and scopes database reads and writes to your business identifier. User session tokens are cryptographically signed with 256-bit secret keys and delivered via HTTP-only, secure, SameSite=Lax cookies.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">5</span>
              Cookies & Tracking Technologies
            </h2>
            <p>OrderFlow uses minimal, essential cookies for authentication and workspace session management:</p>
            <div className="overflow-x-auto rounded-lg border border-surface-200 mt-2">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-50 border-b border-surface-200 text-surface-600 font-semibold">
                  <tr>
                    <th className="p-3">Cookie Name</th>
                    <th className="p-3">Purpose</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Lifespan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  <tr>
                    <td className="p-3 font-mono font-medium">orderflow_session</td>
                    <td className="p-3">Maintains authenticated user session token</td>
                    <td className="p-3"><span className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 font-medium">Strictly Essential</span></td>
                    <td className="p-3">7 Days</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">orderflow_active_business</td>
                    <td className="p-3">Maintains current active business workspace context</td>
                    <td className="p-3"><span className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 font-medium">Strictly Essential</span></td>
                    <td className="p-3">30 Days</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono font-medium">orderflow_cookie_consent</td>
                    <td className="p-3">Stores your privacy and analytics preference choices</td>
                    <td className="p-3"><span className="inline-flex rounded bg-emerald-50 px-2 py-0.5 text-emerald-700 font-medium">Strictly Essential</span></td>
                    <td className="p-3">1 Year</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-surface-500 mt-2">
              Optional analytics tracking is disabled by default and only runs if you explicitly opt in via our Cookie Preferences dialog.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">6</span>
              Third-Party Integrations & Subprocessors
            </h2>
            <p>To deliver core commerce features, OrderFlow connects with select third-party services:</p>
            <ul className="list-disc list-inside space-y-1.5 pl-2 text-surface-700 text-xs">
              <li><strong>Meta Platforms Inc.:</strong> Ingestion of incoming WhatsApp and Instagram messages via official Cloud webhooks when enabled by the merchant.</li>
              <li><strong>PostgreSQL Database Host:</strong> Persistent relational storage with SSL/TLS in-transit encryption.</li>
              <li><strong>Logistics Partners:</strong> Webhook dispatch to shipping aggregators (e.g., Shiprocket, Delhivery, BlueDart) solely when tracking fulfillment is triggered.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">7</span>
              Data Retention, Export & Deletion Rights
            </h2>
            <p>
              Merchants can export all customer records, order histories, and inventory catalogs at any time directly through the dashboard using our RFC-4180 compliant CSV export feature. Upon request or workspace cancellation, your merchant data and associated customer records are permanently deleted from active databases.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">8</span>
              Contact & Privacy Inquiries
            </h2>
            <p>
              If you have questions regarding this Privacy Policy, your workspace data, or wish to exercise data subject rights, please contact our privacy and engineering team at:
            </p>
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 text-xs space-y-1">
              <p><strong>OrderFlow Security & Privacy Desk</strong></p>
              <p>Email: <a href="mailto:privacy@orderflow.app" className="text-brand-600 hover:underline">privacy@orderflow.app</a></p>
              <p>GitHub Repository: <a href="https://github.com/rishaan007/OrderFlow" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">github.com/rishaan007/OrderFlow</a></p>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-200 py-6 bg-surface-50 text-center text-xs text-surface-500">
        <p>&copy; {new Date().getFullYear()} OrderFlow Inc. All rights reserved.</p>
      </footer>
    </div>
  );
}
