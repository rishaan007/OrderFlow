// src/app/buyer/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Instagram,
  MessageSquare,
  ShoppingBag,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  Download,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";

interface PurchaseItem {
  id: string;
  status: string;
  platform: string;
  surface: string;
  publicTrackingToken?: string;
  business?: { name: string; logoUrl?: string };
  seller?: { name: string; logoUrl?: string };
  order: {
    orderNumber: string;
    totalAmount: number;
    currency: string;
    status: string;
    paymentStatus: string;
    shippingAddress?: string;
  };
  createdAt: string;
}

interface PurchasesResponse {
  items: PurchaseItem[];
  counts: { total: number; active: number; completed: number; attention: number };
}

export default function BuyerDashboard() {
  const [sessionStatus, setSessionStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");
  const [purchases, setPurchases] = useState<PurchasesResponse | null>(null);
  const [filter, setFilter] = useState<"ACTIVE" | "COMPLETED" | "ATTENTION" | "ALL">("ACTIVE");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve session via existing custom session API
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => {
        if (r.ok) setSessionStatus("authenticated");
        else setSessionStatus("unauthenticated");
      })
      .catch(() => setSessionStatus("unauthenticated"));
  }, []);

  useEffect(() => {
    if (sessionStatus === "authenticated") {
      fetchPurchases();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, filter]);

  const fetchPurchases = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/buyer/purchases?filter=${filter}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load purchases");
      setPurchases(json.data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const getPlatformBadge = (platform: string) => {
    switch (platform) {
      case "INSTAGRAM":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-pink-700 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded-md">
            <Instagram className="h-3 w-3" /> Instagram
          </span>
        );
      case "WHATSAPP":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
            <MessageSquare className="h-3 w-3" /> WhatsApp
          </span>
        );
      case "FACEBOOK":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
            <span className="font-bold text-[10px]">f</span> Facebook
          </span>
        );
      case "X":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded-md">
            <span className="font-bold text-[10px]">𝕏</span> X
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-surface-700 bg-surface-100 border border-surface-200 px-2 py-0.5 rounded-md">
            <ShoppingBag className="h-3 w-3" /> Direct
          </span>
        );
    }
  };

  if (sessionStatus === "loading") {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <Skeleton className="h-10 w-48 rounded-xl" />
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-6 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto">
            <UserCheck className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-surface-900">Sign in to your OrderFlow</h2>
          <p className="text-xs text-surface-500">
            Sign in to access your universal purchase history across Instagram, WhatsApp, Facebook, and X.
          </p>
          <Link href="/login?redirect=/buyer/dashboard">
            <Button className="w-full">Sign In</Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between border-b border-surface-200 pb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-600 text-white font-bold flex items-center justify-center text-sm">
              OF
            </div>
            <span className="font-semibold text-surface-900">Your OrderFlow</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" size="sm">Purchases</Button>
            <Link href="/marketplace">
              <Button variant="ghost" size="sm" className="gap-1">
                <Globe className="h-3.5 w-3.5" /> Discover
              </Button>
            </Link>
            <Link href="/buyer/notifications">
              <Button variant="ghost" size="sm">Notifications</Button>
            </Link>
            <Link href="/buyer/identity">
              <Button variant="ghost" size="sm">Identity</Button>
            </Link>
            <a href="/api/buyer/export?format=CSV" download>
              <Button variant="outline" size="sm" className="gap-1">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </Button>
            </a>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-surface-900">Universal Purchases</h1>
            <p className="text-xs text-surface-500 mt-0.5">
              All transactions discovered across social platforms, connected to your single OrderFlow identity.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "ACTIVE", label: "Active", count: purchases?.counts?.active },
              { id: "COMPLETED", label: "Completed", count: purchases?.counts?.completed },
              { id: "ATTENTION", label: "Attention", count: purchases?.counts?.attention },
              { id: "ALL", label: "All", count: purchases?.counts?.total },
            ].map((f) => (
              <Button
                key={f.id}
                variant={filter === f.id ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f.id as any)}
                className="text-xs h-8"
              >
                {f.label} {f.count !== undefined ? `(${f.count})` : ""}
              </Button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        )}

        {error && <Alert variant="error" title="Error">{error}</Alert>}

        {purchases && purchases.items.length === 0 && (
          <Card className="p-8 text-center border-surface-200">
            <div className="h-12 w-12 rounded-2xl bg-surface-100 text-surface-400 flex items-center justify-center mx-auto mb-3">
              <ShoppingBag className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-surface-900">No purchases found</h3>
            <p className="text-xs text-surface-500 mt-1 max-w-sm mx-auto">
              {filter === "ALL"
                ? "You haven't claimed any purchases yet. Purchases completed through social commerce will appear here automatically."
                : `No purchases currently matching "${filter.toLowerCase()}".`}
            </p>
            <div className="mt-4">
              <Link href="/buyer/identity">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  Connect Social Accounts & Consolidate Purchases
                </Button>
              </Link>
            </div>
          </Card>
        )}

        {purchases && purchases.items.map((p) => {
          const sellerName = p.business?.name || p.seller?.name || "Verified Seller";
          const sellerLogo = p.business?.logoUrl || p.seller?.logoUrl;
          return (
            <Card key={p.id} className="border-surface-200 shadow-sm overflow-hidden hover:border-surface-300 transition-colors">
              <CardHeader className="bg-surface-50/70 py-3.5 px-4 flex flex-row items-center justify-between border-b border-surface-100">
                <div className="flex items-center gap-3">
                  {sellerLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={sellerLogo} alt={sellerName} className="h-9 w-9 rounded-xl object-cover border border-surface-200" />
                  ) : (
                    <div className="h-9 w-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                      {sellerName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h2 className="font-semibold text-xs text-surface-900">{sellerName}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      {getPlatformBadge(p.platform)}
                      <span className="text-[11px] text-surface-400">
                        {p.surface ? p.surface.replace(/_/g, " ").toLowerCase() : "direct"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant={p.order.paymentStatus === "PAID" ? "success" : "warning"}>
                    {p.order.paymentStatus}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {p.order.status}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="text-surface-400">Order #{p.order.orderNumber}</span>
                    <div className="text-sm font-bold text-surface-900 mt-0.5">
                      {p.order.currency} {p.order.totalAmount}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-surface-400">Purchased</span>
                    <div className="text-xs font-medium text-surface-700 mt-0.5">
                      {formatDate(p.createdAt)}
                    </div>
                  </div>
                </div>

                {p.order.shippingAddress && (
                  <div className="text-xs text-surface-500 bg-surface-50/50 p-2.5 rounded-lg border border-surface-100">
                    <span className="font-medium text-surface-700">Destination: </span>
                    {p.order.shippingAddress}
                  </div>
                )}

                {p.publicTrackingToken && (
                  <div className="pt-1 flex justify-end">
                    <Link href={`/t/${encodeURIComponent(p.publicTrackingToken)}`}>
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                        <span>Open Transaction Room</span>
                        <ChevronRight className="h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
