"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Inbox,
  ShoppingBag,
  Package,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Building2,
  ChevronRight,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { AuthSession } from "@/types";

interface SidebarProps {
  session: AuthSession;
  onCloseMobile?: () => void;
}

export function Sidebar({ session, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    {
      title: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      active: pathname === "/dashboard",
    },
    {
      title: "Inbox",
      href: "/inbox",
      icon: Inbox,
      active: pathname.startsWith("/inbox"),
      badge: "Phase 3",
    },
    {
      title: "Orders",
      href: "/orders",
      icon: ShoppingBag,
      active: pathname.startsWith("/orders"),
    },
    {
      title: "Operations",
      href: "/operations",
      icon: Wallet,
      active: pathname.startsWith("/operations"),
      badge: "Phase 5",
    },
    {
      title: "Inventory",
      href: "/products",
      icon: Package,
      active: pathname.startsWith("/products"),
    },
    {
      title: "Customers",
      href: "/customers",
      icon: Users,
      active: pathname.startsWith("/customers"),
    },
    {
      title: "Trust & Risk",
      href: "/trust",
      icon: ShieldCheck,
      active: pathname.startsWith("/trust"),
    },
    {
      title: "Analytics",
      href: "/analytics",
      icon: BarChart3,
      active: pathname.startsWith("/analytics"),
    },
    {
      title: "Settings",
      href: "/settings",
      icon: Settings,
      active: pathname.startsWith("/settings"),
    },
  ];

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      // Fallback
      router.push("/login");
    }
  };

  const activeBusiness = session.activeBusiness;

  return (
    <aside className="flex h-full w-64 flex-col border-r border-surface-200 bg-white">
      {/* Brand Header & Active Workspace */}
      <div className="flex flex-col border-b border-surface-200 p-4">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-lg shadow-sm">
            O
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight text-surface-950">
              OrderFlow
            </h1>
            <p className="text-xs text-surface-500 font-medium">Merchant Portal</p>
          </div>
        </div>

        {/* Current Active Business Card */}
        {activeBusiness ? (
          <div className="flex items-center justify-between rounded-lg border border-surface-200 bg-surface-50/70 p-2.5">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white border border-surface-200 text-surface-700">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="overflow-hidden">
                <p className="truncate text-xs font-semibold text-surface-900 leading-tight">
                  {activeBusiness.businessName}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-surface-500">
                  <ShieldCheck className="h-3 w-3 text-emerald-600 inline" />
                  <span>{activeBusiness.role}</span>
                </div>
              </div>
            </div>
            <Link
              href="/settings"
              title="Manage workspace settings"
              className="text-surface-400 hover:text-surface-700 p-1"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <Link
            href="/onboarding"
            className="rounded-lg border border-dashed border-brand-300 bg-brand-50/50 p-2 text-center text-xs font-medium text-brand-700 hover:bg-brand-50"
          >
            + Create Workspace
          </Link>
        )}
      </div>

      {/* Main Navigation */}
      <nav aria-label="Workspace navigation" className="flex-1 space-y-1 p-3 overflow-y-auto">
        <div className="px-3 pb-1 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">
            Navigation
          </p>
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              className={cn(
                "group flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                item.active
                  ? "bg-brand-50 text-brand-700 font-semibold"
                  : "text-surface-600 hover:bg-surface-100 hover:text-surface-900"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={cn(
                    "h-4 w-4 transition-colors",
                    item.active
                      ? "text-brand-600"
                      : "text-surface-400 group-hover:text-surface-600"
                  )}
                />
                <span>{item.title}</span>
              </div>
              {item.badge && (
                <span className="rounded bg-surface-100 px-1.5 py-0.5 text-[10px] font-medium text-surface-500">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer Profile & Sign out */}
      <div className="border-t border-surface-200 p-3">
        <div className="flex items-center justify-between rounded-lg p-2 hover:bg-surface-50">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold text-xs border border-brand-200">
              {session.user.name.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="truncate text-xs font-semibold text-surface-900 leading-tight">
                {session.user.name}
              </p>
              <p className="truncate text-[11px] text-surface-500">
                {session.user.email}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Log out"
            className="rounded p-1.5 text-surface-400 hover:bg-surface-200/60 hover:text-rose-600 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
