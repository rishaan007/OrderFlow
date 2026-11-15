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
  AlertCircle,
  CheckCircle2,
  Package,
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

  const getSourceBadge = (source: string) => {
    switch (source) {
      case "INSTAGRAM":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-pink-700 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded">
            <Instagram className="h-3 w-3" /> Instagram
          </span>
        );
      case "WHATSAPP":
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
            <MessageSquare className="h-3 w-3" /> WhatsApp
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-surface-600 bg-surface-100 border border-surface-200 px-2 py-0.5 rounded">
            Direct / Manual
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
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
            Store Overview
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Real-time sales, order pipeline, and customer activity
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
          {/* Channel Setup Checklist (Shown if not fully configured) */}
          {!data.businessInfo.isFullyConfigured && (
            <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/80 to-indigo-50/50 p-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm mt-0.5">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-blue-950">
                      Complete Channel Configuration
                    </h3>
                    <p className="text-xs text-blue-800/80 mt-0.5 max-w-xl">
                      Add your Instagram and WhatsApp handles to activate unified conversation
                      inbox and order draft extraction.
                    </p>
                  </div>
                </div>
                <Link href="/settings">
                  <Button size="sm" variant="default" className="shrink-0 bg-blue-700 hover:bg-blue-800">
                    Configure Profile & Channels
                  </Button>
                </Link>
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
                  <span>from paid orders</span>
                </p>
              </CardContent>
            </Card>

            {/* Total Orders */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                  Total Orders
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
                  <span>all channels</span>
                </p>
              </CardContent>
            </Card>

            {/* Pending Review (AI Drafts / Needs Seller Approval) */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                  Needs Approval
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
                  Pending seller review
                </p>
              </CardContent>
            </Card>

            {/* Active Customers */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                  Customer Records
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
                  <span>repeat profiles</span>
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Quick Action Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Link
              href="/orders"
              className="group flex items-center justify-between rounded-xl border border-surface-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-brand-600 group-hover:text-white transition-colors">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-surface-900">Manage Orders</h4>
                  <p className="text-xs text-surface-500">View and update fulfillment status</p>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-surface-400 group-hover:text-brand-600 transition-colors" />
            </Link>

            <Link
              href="/products"
              className="group flex items-center justify-between rounded-xl border border-surface-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-surface-900">Stock & Products</h4>
                  <p className="text-xs text-surface-500">Track SKUs, prices and counts</p>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-surface-400 group-hover:text-emerald-600 transition-colors" />
            </Link>

            <Link
              href="/settings"
              className="group flex items-center justify-between rounded-xl border border-surface-200 bg-white p-4 shadow-sm hover:border-brand-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                  <Instagram className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-surface-900">Store Profile</h4>
                  <p className="text-xs text-surface-500">Prefixes, currencies & channels</p>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-surface-400 group-hover:text-purple-600 transition-colors" />
            </Link>
          </div>

          {/* Recent Orders Section */}
          <Card className="border-surface-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Orders</CardTitle>
                <CardDescription>
                  Latest customer orders across Instagram, WhatsApp, and manual entry
                </CardDescription>
              </div>
              <Link href="/orders">
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  <span>View All</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {data.recentOrders.length === 0 ? (
                <EmptyState
                  icon={<ShoppingBag className="h-6 w-6" />}
                  title="No orders yet"
                  description="When you create manual orders or receive customer messages, orders will appear here."
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
                        <th className="pb-3 px-4">Customer</th>
                        <th className="pb-3 px-4">Channel</th>
                        <th className="pb-3 px-4">Status</th>
                        <th className="pb-3 px-4">Payment</th>
                        <th className="pb-3 px-4 text-right">Total</th>
                        <th className="pb-3 pl-4 text-right">Date</th>
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
                            {getSourceBadge(order.source)}
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
                          <td className="py-3.5 pl-4 text-right text-xs text-surface-500">
                            {formatDate(order.createdAt)}
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
