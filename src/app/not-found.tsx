import Link from "next/link";
import { ArrowLeft, Home, LayoutDashboard, ShoppingBag, Search, HelpCircle } from "lucide-react";

export const metadata = {
  title: "404 — Page Not Found",
  description: "The page you are looking for does not exist on OrderFlow.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-50">
      {/* Top minimal header */}
      <header className="border-b border-surface-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-lg shadow-sm">
              O
            </div>
            <span className="text-xl font-bold tracking-tight text-surface-900">
              OrderFlow
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* Main 404 content */}
      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="w-full max-w-xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-3 py-1 text-xs font-semibold text-surface-600 shadow-sm mb-6">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            HTTP 404 • Resource Not Found
          </div>

          <h1 className="text-6xl font-extrabold tracking-tight font-mono text-brand-700 sm:text-7xl">
            404
          </h1>

          <h2 className="mt-4 text-2xl font-bold text-surface-900 sm:text-3xl">
            We couldn&apos;t find that page
          </h2>

          <p className="mx-auto mt-4 max-w-md text-base text-surface-600">
            The URL you requested doesn&apos;t exist, was deleted, or belongs to another workspace.
            Please use one of the recovery links below to get back on track.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Workspace Dashboard</span>
            </Link>
            <Link
              href="/orders"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-surface-300 bg-white px-5 py-2.5 text-sm font-medium text-surface-700 shadow-sm hover:bg-surface-50 transition-colors"
            >
              <ShoppingBag className="h-4 w-4" />
              <span>View Orders</span>
            </Link>
            <Link
              href="/"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-transparent px-5 py-2.5 text-sm font-medium text-surface-600 hover:text-surface-900 hover:bg-surface-100 transition-colors"
            >
              <Home className="h-4 w-4" />
              <span>Home</span>
            </Link>
          </div>

          <div className="mt-12 rounded-xl border border-surface-200 bg-white p-6 shadow-sm text-left">
            <h3 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-brand-600" />
              Looking for something specific?
            </h3>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-surface-600">
              <li>
                <Link href="/products" className="hover:text-brand-600 hover:underline">
                  • Product Catalog & Stock
                </Link>
              </li>
              <li>
                <Link href="/inbox" className="hover:text-brand-600 hover:underline">
                  • WhatsApp & IG Inbox
                </Link>
              </li>
              <li>
                <Link href="/customers" className="hover:text-brand-600 hover:underline">
                  • Customer Directory
                </Link>
              </li>
              <li>
                <Link href="/analytics" className="hover:text-brand-600 hover:underline">
                  • Sales & Revenue Reports
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-surface-200 py-6 bg-white text-center text-xs text-surface-500">
        <p>&copy; {new Date().getFullYear()} OrderFlow Inc. Multi-tenant Social Commerce Platform.</p>
      </footer>
    </div>
  );
}
