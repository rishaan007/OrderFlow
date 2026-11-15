"use client";

import Link from "next/link";
import { Menu, Plus, Bell, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthSession } from "@/types";

interface HeaderProps {
  session: AuthSession;
  onOpenMobileMenu: () => void;
}

export function Header({ session, onOpenMobileMenu }: HeaderProps) {
  const activeBusiness = session.activeBusiness;

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-surface-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-surface-500 hidden sm:inline">
            Workspace
          </span>
          <span className="text-sm text-surface-300 hidden sm:inline">/</span>
          <h2 className="text-sm font-semibold text-surface-900 truncate max-w-[200px] sm:max-w-none">
            {activeBusiness?.businessName || "OrderFlow"}
          </h2>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Workspace Quick Link */}
        {activeBusiness?.businessSlug && (
          <span className="hidden md:inline-flex items-center gap-1 rounded-full border border-surface-200 bg-surface-50 px-2.5 py-1 text-xs text-surface-600">
            <span>Slug:</span>
            <strong className="text-surface-900 font-mono">
              {activeBusiness.businessSlug}
            </strong>
          </span>
        )}

        <button
          type="button"
          aria-label="Notifications"
          className="rounded-lg p-2 text-surface-400 hover:bg-surface-100 hover:text-surface-600 transition-colors relative"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand-600" />
        </button>

        <Link href="/orders/new">
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Order</span>
          </Button>
        </Link>
      </div>
    </header>
  );
}
