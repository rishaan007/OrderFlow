import Link from "next/link";
import { ArrowRight, ShoppingBag, MessageSquare, BarChart3, ShieldCheck } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Top Navbar */}
      <header className="border-b border-surface-200">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-lg shadow-sm">
              O
            </div>
            <span className="text-xl font-bold tracking-tight text-surface-900">
              OrderFlow
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-surface-700 hover:text-surface-900 hover:bg-surface-100 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative overflow-hidden py-20 sm:py-28 bg-gradient-to-b from-brand-50/50 to-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 mb-6">
              <span className="flex h-2 w-2 rounded-full bg-brand-600 animate-pulse" />
              SaaS Order Management Built for Instagram & WhatsApp Sellers
            </div>

            <h1 className="text-4xl font-extrabold tracking-tight text-surface-950 sm:text-6xl">
              Turn conversations into <span className="text-brand-600">confirmed orders</span>.
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg text-surface-600">
              OrderFlow centralizes chat messages, customer records, inventory, payments,
              and order tracking in one intuitive, multi-tenant workspace.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/register"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700 transition-all gap-2"
              >
                Start Free Trial <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-surface-300 bg-white px-6 py-3 text-base font-medium text-surface-700 shadow-sm hover:bg-surface-50 transition-colors"
              >
                Sign In to Workspace
              </Link>
            </div>

            {/* Feature Highlights Grid */}
            <div className="mt-20 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4 text-left">
              <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 mb-4">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-surface-900">Unified Inbox</h3>
                <p className="mt-2 text-sm text-surface-500">
                  Connect Instagram Direct & WhatsApp conversations without switching apps.
                </p>
              </div>

              <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 mb-4">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-surface-900">Order Management</h3>
                <p className="mt-2 text-sm text-surface-500">
                  Generate invoices, track shipments, and eliminate lost orders instantly.
                </p>
              </div>

              <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600 mb-4">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-surface-900">Real-time Analytics</h3>
                <p className="mt-2 text-sm text-surface-500">
                  Track top-selling items, revenue growth, and repeat customer retention.
                </p>
              </div>

              <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600 mb-4">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h3 className="font-semibold text-surface-900">Multi-tenant Isolation</h3>
                <p className="mt-2 text-sm text-surface-500">
                  Enterprise-grade data isolation ensuring your customer data is safe and private.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-200 py-8 bg-surface-50 text-center text-sm text-surface-500">
        <p>&copy; {new Date().getFullYear()} OrderFlow Inc. Production SaaS Order Management Platform.</p>
      </footer>
    </div>
  );
}
