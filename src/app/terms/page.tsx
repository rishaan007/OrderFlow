import Link from "next/link";
import { ArrowLeft, FileText, CheckCircle2, AlertTriangle, Shield, Scale } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms and Conditions governing the use of OrderFlow multi-tenant social commerce order management platform.",
  openGraph: {
    title: "OrderFlow Terms of Service",
    description: "Review our Terms of Service governing multi-tenant workspace use and order management operations.",
  },
};

export default function TermsPage() {
  const lastUpdated = "November 16, 2026";

  return (
    <div className="flex min-h-screen flex-col bg-white text-surface-900">
      {/* Top Navbar */}
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

      {/* Main Content */}
      <main className="flex-1 py-12 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full">
        <div className="border-b border-surface-200 pb-8 mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 mb-4">
            <Scale className="h-3.5 w-3.5" />
            Terms of Service & SaaS Agreement
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-surface-950">
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-surface-500">
            Last Updated: <time dateTime="2026-11-16">{lastUpdated}</time> • Effective for all active and trial workspaces
          </p>
        </div>

        {/* Legal Disclaimer Box */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 mb-8 text-xs text-amber-900 leading-relaxed">
          <strong>Important Notice:</strong> These Terms of Service constitute a legally binding agreement between OrderFlow Inc. (&quot;OrderFlow&quot;, &quot;we&quot;, &quot;us&quot;) and the organization or individual subscribing to the service (&quot;Merchant&quot;, &quot;you&quot;). Individual merchants operating under regional retail laws are encouraged to have independent counsel review their specific e-commerce liabilities.
        </div>

        <div className="space-y-10 text-sm leading-relaxed text-surface-700">
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">1</span>
              Acceptance & Scope of Service
            </h2>
            <p>
              By creating an account, onboarding a business workspace, or using OrderFlow, you agree to these Terms. If you represent an organization or business, you warrant that you possess the authority to bind that entity to these Terms. OrderFlow provides a multi-tenant order management, conversational commerce inbox, inventory tracking, payment recording, and logistics coordination platform.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">2</span>
              Merchant Responsibilities & Acceptable Use
            </h2>
            <p>As a merchant utilizing OrderFlow, you explicitly agree that:</p>
            <ul className="list-disc list-inside space-y-1.5 pl-2 text-surface-700">
              <li>You are solely responsible for the legality, quality, and accurate description of all products and variants listed in your catalog.</li>
              <li>You will comply with all relevant consumer protection laws, tax collection regulations, and refund obligations applicable in your operating jurisdiction.</li>
              <li>You will adhere to Meta Platforms Inc. Commerce and Messaging Policies when ingesting WhatsApp and Instagram Direct conversations.</li>
              <li>You will not use the service to sell counterfeit goods, prohibited contraband, or engage in deceptive payment collection practices.</li>
              <li>You are responsible for safeguarding all team invitation links, session cookies, and API credentials issued to your workspace.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">3</span>
              Subscription Plans, Quotas & Payment Terms
            </h2>
            <div className="overflow-x-auto rounded-lg border border-surface-200 mt-2">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-50 border-b border-surface-200 text-surface-600 font-semibold">
                  <tr>
                    <th className="p-3">Plan Tier</th>
                    <th className="p-3">Monthly Order Quota</th>
                    <th className="p-3">Team Seats</th>
                    <th className="p-3">Fulfillment & Analytics</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  <tr>
                    <td className="p-3 font-semibold text-surface-900">FREE</td>
                    <td className="p-3">50 orders / month</td>
                    <td className="p-3">1 seat (Owner)</td>
                    <td className="p-3">Core inbox, manual orders, basic reports</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-surface-900">PRO</td>
                    <td className="p-3">500 orders / month</td>
                    <td className="p-3">5 team seats</td>
                    <td className="p-3">AI extraction, multi-carrier dispatch, CSV exports</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-surface-900">ENTERPRISE</td>
                    <td className="p-3">Unlimited throughput</td>
                    <td className="p-3">Unlimited team seats</td>
                    <td className="p-3">Custom webhooks, SLA, priority phone support</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-surface-600 mt-2">
              <strong>Quota Enforcement:</strong> Hard limits are enforced at the database layer. When a workspace exhausts its monthly order quota, further order creation is halted until the next billing cycle or until the workspace plan is upgraded.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">4</span>
              Payment Verification & Financial Records
            </h2>
            <p>
              OrderFlow provides financial recordkeeping tools (UPI reference tracking, cash-on-delivery tracking, screenshot verification, and partial payment reconciliation). OrderFlow does not directly process credit card transactions or hold merchant funds. Merchants are solely responsible for verifying the authenticity of customer payment receipts and bank settlements.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">5</span>
              Data Ownership & Intellectual Property
            </h2>
            <p>
              Merchants retain 100% ownership of their product catalogs, images, customer records, and order transaction data. OrderFlow and its licensors retain all intellectual property rights in the software platform, user interface designs, logos, and underlying proprietary algorithms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">6</span>
              Limitation of Liability & Warranty Disclaimer
            </h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, ORDERFLOW IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND. IN NO EVENT SHALL ORDERFLOW BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR BUSINESS INTERRUPTION ARISING FROM THE USE OF OR INABILITY TO USE THE PLATFORM.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">7</span>
              Termination & Account Suspension
            </h2>
            <p>
              You may terminate your workspace at any time by exporting your data and deleting your account. OrderFlow reserves the right to suspend or terminate workspaces that violate these Terms, engage in fraud, or create security risks for other tenants on the shared infrastructure.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-surface-900 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-brand-700 text-xs font-bold">8</span>
              Governing Law & Legal Contact
            </h2>
            <p>
              For legal inquiries, dispute notifications, or contractual questions, please reach out to:
            </p>
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 text-xs space-y-1">
              <p><strong>OrderFlow Legal & Compliance Department</strong></p>
              <p>Email: <a href="mailto:legal@orderflow.app" className="text-brand-600 hover:underline">legal@orderflow.app</a></p>
              <p>Support Inquiries: <a href="mailto:support@orderflow.app" className="text-brand-600 hover:underline">support@orderflow.app</a></p>
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
