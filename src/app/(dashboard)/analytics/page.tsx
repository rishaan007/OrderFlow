"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  Users,
  CreditCard,
  AlertCircle,
  Download,
  Calendar,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  PackageCheck,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { formatCurrency, formatDate } from "@/lib/utils";

interface AnalyticsData {
  periodDays: number;
  revenue: {
    grossRevenue: number;
    netRevenue: number;
    totalOrders: number;
    completedOrders: number;
    pendingOrders: number;
    cancelledOrders: number;
    averageOrderValue: number;
    currency: string;
    timeSeries: Array<{ date: string; revenue: number; orders: number }>;
    channelBreakdown: Array<{ channel: string; revenue: number; orders: number; percentage: number }>;
  };
  productPerformance: {
    topProducts: Array<{
      id: string;
      title: string;
      sku: string | null;
      unitsSold: number;
      revenue: number;
      currentStock: number;
    }>;
    inventorySummary: {
      totalProducts: number;
      totalStockUnits: number;
      lowStockCount: number;
      outOfStockCount: number;
      totalRetailValue: number;
      totalCostValue: number;
    };
  };
  customerRetention: {
    totalCustomers: number;
    newCustomers: number;
    repeatCustomers: number;
    repeatCustomerRate: number;
    averageLifetimeValue: number;
    topCustomers: Array<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      ordersCount: number;
      totalSpent: number;
      lastOrderDate?: string | null;
    }>;
    inactiveCustomersCount: number;
  };
  paymentReport: {
    totalCollected: number;
    pendingVerification: number;
    rejectedAmount: number;
    totalOutstanding: number;
    currency: string;
    methodDistribution: Array<{
      method: string;
      amount: number;
      count: number;
      percentage: number;
    }>;
    outstandingOrders: Array<{
      id: string;
      orderNumber: string;
      customerName: string;
      customerPhone: string | null;
      orderDate: string;
      totalAmount: number;
      amountPaid: number;
      balanceDue: number;
      status: string;
    }>;
  };
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<number>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<string | null>(null);

  const fetchAnalytics = async (days: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics?days=${days}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load analytics");
      }
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics(period);
  }, [period]);

  const handleExport = (type: string) => {
    setIsExporting(type);
    window.location.href = `/api/export/${type}`;
    setTimeout(() => setIsExporting(null), 2000);
  };

  if (isLoading && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const currency = data?.revenue.currency || "USD";
  const revenue = data?.revenue;
  const products = data?.productPerformance;
  const customers = data?.customerRetention;
  const payments = data?.paymentReport;

  // Calculate SVG chart scaling
  const timeSeries = revenue?.timeSeries || [];
  const maxRevenue = Math.max(...timeSeries.map((t) => t.revenue), 100);

  return (
    <div className="space-y-8 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
              Analytics & Intelligence
            </h1>
            <Badge variant="default" className="bg-brand-600 text-white gap-1">
              <Sparkles className="h-3 w-3" /> Live Database Aggregation
            </Badge>
          </div>
          <p className="mt-1 text-sm text-surface-500">
            Real-time financial performance, product velocity, channel attribution, and retention
          </p>
        </div>

        {/* Date Selector & Export Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-surface-200 bg-white p-1 shadow-sm">
            {[
              { label: "7 Days", value: 7 },
              { label: "30 Days", value: 30 },
              { label: "90 Days", value: 90 },
            ].map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  period === p.value
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-surface-600 hover:text-surface-900 hover:bg-surface-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg border border-surface-200 bg-white p-1 shadow-sm">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport("orders")}
              isLoading={isExporting === "orders"}
              className="text-xs gap-1.5 h-8"
            >
              <Download className="h-3.5 w-3.5" />
              Orders CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport("payments")}
              isLoading={isExporting === "payments"}
              className="text-xs gap-1.5 h-8 ml-1"
            >
              <Download className="h-3.5 w-3.5" />
              Financials CSV
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Failed to load analytics">
          {error}
        </Alert>
      )}

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Gross Revenue */}
        <Card className="p-5 shadow-sm border-surface-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">Gross Revenue</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-surface-900">
              {formatCurrency(revenue?.grossRevenue || 0, currency)}
            </span>
          </div>
          <div className="mt-2 flex items-center text-xs text-surface-500 gap-1.5">
            <span className="text-emerald-600 font-semibold">Net: {formatCurrency(revenue?.netRevenue || 0, currency)}</span>
            <span>• last {period} days</span>
          </div>
        </Card>

        {/* Total Orders */}
        <Card className="p-5 shadow-sm border-surface-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">Total Orders</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <ShoppingBag className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-surface-900">{revenue?.totalOrders || 0}</span>
            <span className="text-xs text-surface-500 font-medium">orders</span>
          </div>
          <div className="mt-2 flex items-center text-xs text-surface-500 gap-1">
            <span className="text-blue-600 font-semibold">{revenue?.completedOrders || 0} delivered</span>
            <span>• {revenue?.cancelledOrders || 0} cancelled</span>
          </div>
        </Card>

        {/* Average Order Value */}
        <Card className="p-5 shadow-sm border-surface-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">Avg Order Value (AOV)</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-surface-900">
              {formatCurrency(revenue?.averageOrderValue || 0, currency)}
            </span>
          </div>
          <div className="mt-2 flex items-center text-xs text-surface-500 gap-1">
            <span className="text-purple-600 font-semibold">Repeat Rate: {customers?.repeatCustomerRate || 0}%</span>
          </div>
        </Card>

        {/* Outstanding Receivables */}
        <Card className="p-5 shadow-sm border-surface-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-500 uppercase tracking-wider">Outstanding Balance</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <AlertCircle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-amber-700">
              {formatCurrency(payments?.totalOutstanding || 0, currency)}
            </span>
          </div>
          <div className="mt-2 flex items-center text-xs text-surface-500 gap-1">
            <span>Collected:</span>
            <span className="text-emerald-600 font-semibold">
              {formatCurrency(payments?.totalCollected || 0, currency)}
            </span>
          </div>
        </Card>
      </div>

      {/* Main Revenue Trend & Channel Attribution Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Revenue Time Series Chart */}
        <Card className="lg:col-span-2 shadow-sm border-surface-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Sales & Order Trend</CardTitle>
                <CardDescription>Daily gross revenue and order volume for past {period} days</CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">
                {timeSeries.length} Days Recorded
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {timeSeries.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-surface-400">
                No order transactions in this date range.
              </div>
            ) : (
              <div className="space-y-4">
                {/* SVG Trend Bar Chart */}
                <div className="h-56 w-full flex items-end gap-1 pt-6 px-2">
                  {timeSeries.map((t, idx) => {
                    const heightPercent = maxRevenue > 0 ? Math.max(6, Math.round((t.revenue / maxRevenue) * 100)) : 6;
                    return (
                      <div
                        key={idx}
                        className="group relative flex-1 flex flex-col items-center h-full justify-end"
                      >
                        {/* Tooltip */}
                        <div className="absolute -top-12 z-10 hidden group-hover:flex flex-col items-center bg-surface-900 text-white text-[10px] rounded px-2 py-1 shadow-md whitespace-nowrap pointer-events-none">
                          <span className="font-semibold">{t.date}</span>
                          <span>{formatCurrency(t.revenue, currency)} ({t.orders} orders)</span>
                        </div>
                        {/* Bar */}
                        <div
                          style={{ height: `${heightPercent}%` }}
                          className={`w-full rounded-t transition-all duration-200 ${
                            t.revenue > 0
                              ? "bg-brand-500 group-hover:bg-brand-600"
                              : "bg-surface-100 group-hover:bg-surface-200"
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>
                {/* Axis Labels */}
                <div className="flex items-center justify-between text-[11px] text-surface-400 border-t border-surface-100 pt-2 px-2">
                  <span>{timeSeries[0]?.date}</span>
                  <span>Daily Revenue Distribution</span>
                  <span>{timeSeries[timeSeries.length - 1]?.date}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Channel Attribution Breakdown */}
        <Card className="shadow-sm border-surface-200">
          <CardHeader>
            <CardTitle>Sales by Channel</CardTitle>
            <CardDescription>Order volume and revenue by origin</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {revenue?.channelBreakdown.map((ch) => (
              <div key={ch.channel} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-surface-800 flex items-center gap-1.5">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        ch.channel === "WHATSAPP"
                          ? "bg-emerald-500"
                          : ch.channel === "INSTAGRAM"
                          ? "bg-pink-500"
                          : ch.channel === "ONLINE"
                          ? "bg-indigo-500"
                          : "bg-surface-400"
                      }`}
                    />
                    {ch.channel}
                  </span>
                  <div className="text-right">
                    <span className="font-bold text-surface-900">{formatCurrency(ch.revenue, currency)}</span>
                    <span className="text-surface-400 ml-1.5">({ch.orders} orders)</span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-100">
                  <div
                    style={{ width: `${ch.percentage}%` }}
                    className={`h-full rounded-full transition-all duration-300 ${
                      ch.channel === "WHATSAPP"
                        ? "bg-emerald-500"
                        : ch.channel === "INSTAGRAM"
                        ? "bg-pink-500"
                        : ch.channel === "ONLINE"
                        ? "bg-indigo-500"
                        : "bg-surface-400"
                    }`}
                  />
                </div>
              </div>
            ))}

            <div className="rounded-lg bg-surface-50 p-3.5 border border-surface-200 text-xs space-y-1">
              <div className="flex justify-between font-semibold text-surface-700">
                <span>Inventory Retail Value:</span>
                <span className="text-surface-900">
                  {formatCurrency(products?.inventorySummary.totalRetailValue || 0, currency)}
                </span>
              </div>
              <div className="flex justify-between text-surface-500">
                <span>Low Stock Threshold Items:</span>
                <span className="font-semibold text-amber-600">{products?.inventorySummary.lowStockCount || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Section: Top Products & Customer Retention */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Products */}
        <Card className="shadow-sm border-surface-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Top Selling Products</CardTitle>
                <CardDescription>Ranked by revenue contribution</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("products")}
                className="text-xs h-7"
              >
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(!products?.topProducts || products.topProducts.length === 0) ? (
              <div className="py-8 text-center text-sm text-surface-400">
                No product sales recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-surface-100">
                {products.topProducts.map((p, idx) => (
                  <div key={p.id || idx} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-100 text-xs font-bold text-surface-600">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-surface-900 leading-tight">{p.title}</p>
                        <p className="text-xs text-surface-500">
                          {p.sku ? `SKU: ${p.sku} • ` : ""}
                          {p.unitsSold} units sold
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-surface-900">{formatCurrency(p.revenue, currency)}</p>
                      <span
                        className={`text-[11px] font-medium ${
                          p.currentStock <= 5 ? "text-amber-600" : "text-emerald-600"
                        }`}
                      >
                        {p.currentStock} in stock
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Customer Retention & Cohort Health */}
        <Card className="shadow-sm border-surface-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Customer Retention & LTV</CardTitle>
                <CardDescription>Cohort health, repeat buyers and top VIP accounts</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport("customers")}
                className="text-xs h-7"
              >
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Quick Retention Metrics Grid */}
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-50 p-3 text-center border border-surface-200">
              <div>
                <span className="text-[11px] text-surface-500 uppercase tracking-wider block">Total</span>
                <span className="text-lg font-bold text-surface-900">{customers?.totalCustomers || 0}</span>
              </div>
              <div>
                <span className="text-[11px] text-surface-500 uppercase tracking-wider block">Repeat Rate</span>
                <span className="text-lg font-bold text-brand-600">{customers?.repeatCustomerRate || 0}%</span>
              </div>
              <div>
                <span className="text-[11px] text-surface-500 uppercase tracking-wider block">Avg LTV</span>
                <span className="text-lg font-bold text-emerald-600">
                  {formatCurrency(customers?.averageLifetimeValue || 0, currency)}
                </span>
              </div>
            </div>

            {/* Top VIP Customers List */}
            <div className="divide-y divide-surface-100">
              {customers?.topCustomers.slice(0, 5).map((cust, idx) => (
                <div key={cust.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xs font-semibold">
                      {cust.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-surface-900 leading-tight">{cust.name}</p>
                      <p className="text-[11px] text-surface-400">
                        {cust.ordersCount} orders • {cust.phone || cust.email || "Direct"}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-surface-900">
                    {formatCurrency(cust.totalSpent, currency)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Outstanding Receivables Table */}
      <Card className="shadow-sm border-surface-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-amber-600" />
                Outstanding Balances & Unpaid Receivables
              </CardTitle>
              <CardDescription>Orders with pending unpaid balances requiring collection</CardDescription>
            </div>
            <Badge variant="outline" className="text-xs text-amber-700 bg-amber-50 border-amber-200">
              {payments?.outstandingOrders.length || 0} Unpaid Orders
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {(!payments?.outstandingOrders || payments.outstandingOrders.length === 0) ? (
            <div className="py-8 text-center text-sm text-surface-400">
              🎉 All confirmed orders have been fully paid. No outstanding receivables!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-surface-600 font-semibold">
                    <th className="py-2.5 px-3">Order Number</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Order Date</th>
                    <th className="py-2.5 px-3 text-right">Total Amount</th>
                    <th className="py-2.5 px-3 text-right">Amount Paid</th>
                    <th className="py-2.5 px-3 text-right text-amber-700 font-bold">Balance Due</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {payments.outstandingOrders.slice(0, 10).map((ord) => (
                    <tr key={ord.id} className="hover:bg-surface-50/50">
                      <td className="py-2.5 px-3 font-semibold text-brand-600">
                        <a href={`/orders`} className="hover:underline">
                          #{ord.orderNumber}
                        </a>
                      </td>
                      <td className="py-2.5 px-3 text-surface-800 font-medium">
                        {ord.customerName}
                        {ord.customerPhone && <span className="text-[11px] text-surface-400 block">{ord.customerPhone}</span>}
                      </td>
                      <td className="py-2.5 px-3 text-surface-500">{formatDate(ord.orderDate)}</td>
                      <td className="py-2.5 px-3 text-right font-medium text-surface-700">
                        {formatCurrency(ord.totalAmount, currency)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-emerald-600">
                        {formatCurrency(ord.amountPaid, currency)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-amber-700">
                        {formatCurrency(ord.balanceDue, currency)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge variant="outline" className="text-[10px]">
                          {ord.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
