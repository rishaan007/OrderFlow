"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DollarSign,
  ShoppingBag,
  Clock,
  Users,
  Plus,
  ArrowUpRight,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Instagram,
  CheckCircle2,
  Package,
  AlertTriangle,
  Share2,
  ShieldCheck,
  CreditCard,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { DashboardStatsResponse } from "@/types";
import { formatDate } from "@/lib/utils";

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/stats");
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load dashboard metrics");
      }

      setData(json.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error connecting to server";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const getSourceBadge = (source: string, surface?: string | null) => {
    const surfaceTag = surface ? surface.replace(/_/g, " ").toLowerCase() : null;

    switch (source) {
      case "INSTAGRAM":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-pink-700 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded-md">
            <Instagram className="h-3 w-3" />
            <span>Instagram</span>
            {surfaceTag && <span className="text-[10px] opacity-75 font-mono">({surfaceTag})</span>}
          </span>
        );
      case "WHATSAPP":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
            <MessageSquare className="h-3 w-3" />
            <span>WhatsApp</span>
            {surfaceTag && <span className="text-[10px] opacity-75 font-mono">({surfaceTag})</span>}
          </span>
        );
      case "FACEBOOK":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
            <Layers className="h-3 w-3" />
            <span>Facebook</span>
            {surfaceTag && <span className="text-[10px] opacity-75 font-mono">({surfaceTag})</span>}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-600 bg-surface-100 border border-surface-200 px-2 py-0.5 rounded-md">
            <span>Direct</span>
            {surfaceTag && <span className="text-[10px] opacity-75 font-mono">({surfaceTag})</span>}
          </span>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return <Badge variant="success">Confirmed</Badge>;
      case "PROCESSING":
        return <Badge variant="default">Processing</Badge>;
      case "SHIPPED":
        return <Badge variant="default">Shipped</Badge>;
      case "DELIVERED":
        return <Badge variant="success">Delivered</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="warning">Pending</Badge>;
    }
  };

  const getPaymentBadge = (status: string) => {
    switch (status) {
      case "PAID":
        return (
          <span className="inline-flex items-center text-xs font-medium text-emerald-700">
            ● Paid
          </span>
        );
      case "PARTIALLY_PAID":
        return (
          <span className="inline-flex items-center text-xs font-medium text-amber-700">
            ● Partial
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center text-xs font-medium text-surface-500">
            ○ Unpaid
          </span>
        );
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Title & Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
              Social Commerce Command Center
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 border border-brand-200">
              <ShieldCheck className="h-3 w-3" /> Transaction OS
            </span>
          </div>
          <p className="mt-1 text-sm text-surface-500">
            Canonical transactions across Instagram, WhatsApp, Facebook, and direct commerce
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchStats}
            isLoading={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </Button>

          <Link href="/orders/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span>Create Order</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Alert variant="error" title="Error Loading Dashboard">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={fetchStats}>
              Retry
            </Button>
          </div>
        </Alert>
      )}

      {/* Loading Skeletons */}
      {isLoading && !data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-6">
                <Skeleton className="h-4 w-28 mb-3" />
                <Skeleton className="h-8 w-36 mb-2" />
                <Skeleton className="h-3 w-20" />
              </Card>
            ))}
          </div>

          <Card className="p-6">
            <Skeleton className="h-6 w-48 mb-4" />
            <Skeleton className="h-64 w-full" />
          </Card>
        </div>
      )}

      {/* Success State */}
      {data && (
        <>
          {/* Attention Required Section (if any actions pending) */}
          {data.attentionRequired &&
            (data.attentionRequired.pendingPaymentVerifications > 0 ||
              data.attentionRequired.openDisputes > 0 ||
              data.attentionRequired.lowStockItems > 0) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="flex items-center gap-2 mb-2 font-semibold text-amber-900 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>Immediate Action Required</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {data.attentionRequired.pendingPaymentVerifications > 0 && (
                    <Link
                      href="/orders?paymentStatus=PENDING"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800 bg-white border border-amber-300 px-3 py-1 rounded-lg hover:bg-amber-100 transition-colors shadow-2xs"
                    >
                      <CreditCard className="h-3.5 w-3.5 text-amber-600" />
                      <span>{data.attentionRequired.pendingPaymentVerifications} Payment(s) Pending Verification</span>
                    </Link>
                  )}
                  {data.attentionRequired.openDisputes > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-800 bg-white border border-red-300 px-3 py-1 rounded-lg shadow-2xs">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                      <span>{data.attentionRequired.openDisputes} Active Buyer Dispute(s)</span>
                    </span>
                  )}
                  {data.attentionRequired.lowStockItems > 0 && (
                    <Link
                      href="/products"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-800 bg-white border border-surface-300 px-3 py-1 rounded-lg hover:bg-surface-50 transition-colors shadow-2xs"
                    >
                      <Package className="h-3.5 w-3.5 text-amber-600" />
                      <span>{data.attentionRequired.lowStockItems} Low Stock Item(s)</span>
                    </Link>
                  )}
                </div>
              </div>
            )}

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Revenue */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                  Total Revenue
                </CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <DollarSign className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight text-surface-950">
                  {data.metrics.totalRevenue.formatted}
                </div>
                <p className="mt-1 text-xs text-surface-500 flex items-center gap-1">
                  <span className="text-emerald-600 font-medium inline-flex items-center">
                    +{data.metrics.totalRevenue.changePercentage}%
                  </span>
                  <span>from verified paid transactions</span>
                </p>
              </CardContent>
            </Card>

            {/* Total Orders */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                  Orders Created
                </CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <ShoppingBag className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight text-surface-950">
                  {data.metrics.totalOrders.value}
                </div>
                <p className="mt-1 text-xs text-surface-500 flex items-center gap-1">
                  <span className="text-blue-600 font-medium inline-flex items-center">
                    +{data.metrics.totalOrders.changePercentage}%
                  </span>
                  <span>across all social surfaces</span>
                </p>
              </CardContent>
            </Card>

            {/* Needs Approval */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                  Pending Orders
                </CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                  <Clock className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight text-surface-950">
                  {data.metrics.pendingReview.value}
                </div>
                <p className="mt-1 text-xs text-surface-500 truncate" title={data.metrics.pendingReview.description}>
                  Requires seller confirmation
                </p>
              </CardContent>
            </Card>

            {/* Active Customers */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                  Buyer Profiles
                </CardTitle>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                  <Users className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight text-surface-950">
                  {data.metrics.activeCustomers.value}
                </div>
                <p className="mt-1 text-xs text-surface-500 flex items-center gap-1">
                  <span className="text-purple-600 font-medium inline-flex items-center">
                    +{data.metrics.activeCustomers.changePercentage}%
                  </span>
                  <span>social commerce CRM</span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Social Platform Performance Matrix */}
          {data.socialCommerce && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* Instagram */}
              <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-surface-600 flex items-center gap-1.5">
                    <Instagram className="h-4 w-4 text-pink-600" /> Instagram
                  </span>
                  <span className="text-[11px] font-medium text-surface-400">
                    {data.socialCommerce.platformBreakdown.INSTAGRAM?.count || 0} orders
                  </span>
                </div>
                <div className="text-lg font-bold text-surface-900">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: data.businessInfo.currency || "USD",
                  }).format(data.socialCommerce.platformBreakdown.INSTAGRAM?.revenue || 0)}
                </div>
                <div className="text-[11px] text-surface-400 mt-0.5">DMs, Stories, Reels</div>
              </div>

              {/* WhatsApp */}
              <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-surface-600 flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4 text-emerald-600" /> WhatsApp
                  </span>
                  <span className="text-[11px] font-medium text-surface-400">
                    {data.socialCommerce.platformBreakdown.WHATSAPP?.count || 0} orders
                  </span>
                </div>
                <div className="text-lg font-bold text-surface-900">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: data.businessInfo.currency || "USD",
                  }).format(data.socialCommerce.platformBreakdown.WHATSAPP?.revenue || 0)}
                </div>
                <div className="text-[11px] text-surface-400 mt-0.5">Direct Chat & Catalog</div>
              </div>

              {/* Facebook */}
              <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-surface-600 flex items-center gap-1.5">
                    <Layers className="h-4 w-4 text-blue-600" /> Facebook
                  </span>
                  <span className="text-[11px] font-medium text-surface-400">
                    {data.socialCommerce.platformBreakdown.FACEBOOK?.count || 0} orders
                  </span>
                </div>
                <div className="text-lg font-bold text-surface-900">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: data.businessInfo.currency || "USD",
                  }).format(data.socialCommerce.platformBreakdown.FACEBOOK?.revenue || 0)}
                </div>
                <div className="text-[11px] text-surface-400 mt-0.5">Messenger & Marketplace</div>
              </div>

              {/* Direct / Manual */}
              <div className="rounded-xl border border-surface-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-surface-600 flex items-center gap-1.5">
                    <ShoppingBag className="h-4 w-4 text-surface-600" /> Direct / Other
                  </span>
                  <span className="text-[11px] font-medium text-surface-400">
                    {data.socialCommerce.platformBreakdown.MANUAL?.count || 0} orders
                  </span>
                </div>
                <div className="text-lg font-bold text-surface-900">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: data.businessInfo.currency || "USD",
                  }).format(data.socialCommerce.platformBreakdown.MANUAL?.revenue || 0)}
                </div>
                <div className="text-[11px] text-surface-400 mt-0.5">In-person & Manual Entry</div>
              </div>
            </div>
          )}

          {/* Recent Social Transactions Table */}
          <Card className="border-surface-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Transactions</CardTitle>
                <CardDescription>
                  Canonical transaction records with live buyer-facing shared rooms
                </CardDescription>
              </div>
              <Link href="/orders">
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  <span>View All Orders</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {data.recentOrders.length === 0 ? (
                <EmptyState
                  icon={<ShoppingBag className="h-6 w-6" />}
                  title="No transactions yet"
                  description="When you create orders or sync customer messages, transactions will appear here."
                  action={
                    <Link href="/orders/new">
                      <Button size="sm">Create First Order</Button>
                    </Link>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-surface-200 text-xs font-semibold uppercase tracking-wider text-surface-500">
                      <tr>
                        <th className="pb-3 pr-4">Order #</th>
                        <th className="pb-3 px-4">Buyer</th>
                        <th className="pb-3 px-4">Social Context</th>
                        <th className="pb-3 px-4">Status</th>
                        <th className="pb-3 px-4">Payment</th>
                        <th className="pb-3 px-4 text-right">Total</th>
                        <th className="pb-3 pl-4 text-center">Buyer Room</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {data.recentOrders.map((order) => (
                        <tr
                          key={order.id}
                          className="hover:bg-surface-50/70 transition-colors"
                        >
                          <td className="py-3.5 pr-4 font-mono font-medium text-surface-900">
                            {order.orderNumber}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-medium text-surface-900">
                              {order.customerName}
                            </div>
                            {order.customerContact && (
                              <div className="text-xs text-surface-400">
                                {order.customerContact}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            {getSourceBadge(order.platform || order.source, order.surface)}
                          </td>
                          <td className="py-3.5 px-4">
                            {getStatusBadge(order.status)}
                          </td>
                          <td className="py-3.5 px-4">
                            {getPaymentBadge(order.paymentStatus)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-medium text-surface-900">
                            {order.formattedAmount}
                          </td>
                          <td className="py-3.5 pl-4 text-center">
                            {order.trackingToken ? (
                              <Link
                                href={`/t/${order.trackingToken}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors border border-brand-200"
                                title="Open Buyer-Facing Shared Room"
                              >
                                <Share2 className="h-3 w-3" />
                                <span>Room</span>
                                <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                              </Link>
                            ) : (
                              <span className="text-xs text-surface-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
