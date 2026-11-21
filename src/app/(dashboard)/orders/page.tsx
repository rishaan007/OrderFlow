"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShoppingBag,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Eye,
  CheckCircle2,
  XCircle,
  Truck,
  Instagram,
  MessageSquare,
  AlertCircle,
  Clock,
  DollarSign,
  Package,
  ExternalLink,
  Sparkles,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { OrderItemSummary, OrderStatus, PaymentStatus, OrderSource } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderItemSummary[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [paymentFilter, setPaymentFilter] = useState<string>("ALL");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");

  // Selected Order for Drawer
  const [selectedOrder, setSelectedOrder] = useState<OrderItemSummary | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrders = async (page = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      if (search) params.set("search", search);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (paymentFilter !== "ALL") params.set("paymentStatus", paymentFilter);
      if (sourceFilter !== "ALL") params.set("source", sourceFilter);

      const res = await fetch(`/api/orders?${params.toString()}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load orders");
      }

      setOrders(json.data.items);
      setPagination(json.data.pagination);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error connecting to server";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchOrders(1);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, paymentFilter, sourceFilter]);

  // Quick State Transitions
  const handleUpdateStatus = async (orderId: string, newStatus: OrderStatus) => {
    setActionLoading(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update order status");
      }

      fetchOrders(pagination.page);
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(json.data);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error updating order");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdatePayment = async (orderId: string, newPaymentStatus: PaymentStatus) => {
    setActionLoading(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: newPaymentStatus }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update payment status");
      }

      fetchOrders(pagination.page);
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(json.data);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error updating payment");
    } finally {
      setActionLoading(null);
    }
  };

  const getSourceBadge = (source: OrderSource) => {
    switch (source) {
      case "INSTAGRAM":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-pink-700 bg-pink-50 border border-pink-200 px-2 py-0.5 rounded">
            <Instagram className="h-3 w-3" /> Instagram
          </span>
        );
      case "WHATSAPP":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
            <MessageSquare className="h-3 w-3" /> WhatsApp
          </span>
        );
      case "FACEBOOK":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
            <span className="h-2 w-2 rounded-full bg-blue-600" /> Facebook
          </span>
        );
      case "X":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-800 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded">
            <span className="h-2 w-2 rounded-full bg-slate-900" /> X / Twitter
          </span>
        );
      case "ONLINE":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
            <Globe className="h-3 w-3" /> Online Store
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-surface-600 bg-surface-100 border border-surface-200 px-2 py-0.5 rounded">
            Manual
          </span>
        );
    }
  };

  const getStatusBadge = (status: OrderStatus, requiresApproval?: boolean) => {
    if (requiresApproval) {
      return (
        <Badge variant="warning" className="gap-1 animate-pulse">
          <Clock className="h-3 w-3" />
          <span>Needs Review</span>
        </Badge>
      );
    }

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
            Orders
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Omnichannel order pipeline, status controls, delivery updates, and automated stock deductions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchOrders(pagination.page)}
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

      {error && (
        <Alert variant="error" title="Error">
          {error}
        </Alert>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-200 pb-3">
        {[
          { label: "All Orders", value: "ALL" },
          { label: "Needs Review", value: "PENDING" },
          { label: "Confirmed", value: "CONFIRMED" },
          { label: "Processing", value: "PROCESSING" },
          { label: "Shipped", value: "SHIPPED" },
          { label: "Delivered", value: "DELIVERED" },
          { label: "Cancelled", value: "CANCELLED" },
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              statusFilter === tab.value
                ? "bg-brand-600 text-white shadow-sm"
                : "text-surface-600 hover:bg-surface-100 hover:text-surface-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search & Channel Selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3 max-w-md">
          <Input
            placeholder="Search by order #, customer, or phone..."
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="h-9 rounded-lg border border-surface-300 bg-white px-3 py-1 text-xs font-medium text-surface-700"
          >
            <option value="ALL">All Payments</option>
            <option value="PAID">Paid</option>
            <option value="PENDING">Unpaid / COD</option>
            <option value="PARTIALLY_PAID">Partially Paid</option>
            <option value="REFUNDED">Refunded</option>
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 rounded-lg border border-surface-300 bg-white px-3 py-1 text-xs font-medium text-surface-700"
          >
            <option value="ALL">All Channels</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK">Facebook</option>
            <option value="X">X / Twitter</option>
            <option value="ONLINE">Online Store</option>
            <option value="MANUAL">Manual</option>
          </select>
        </div>
      </div>

      {/* Loading Skeletons */}
      {isLoading && orders.length === 0 ? (
        <Card className="p-6">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" />}
          title="No orders found"
          description={
            statusFilter !== "ALL"
              ? `No orders matching status "${statusFilter}".`
              : "No orders placed yet. Create manual orders or receive customer orders."
          }
          action={
            <Link href="/orders/new">
              <Button size="sm">Create First Order</Button>
            </Link>
          }
        />
      ) : (
        <Card className="border-surface-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-200 bg-surface-50/70 text-xs font-semibold uppercase tracking-wider text-surface-500">
                <tr>
                  <th className="py-3 px-4">Order #</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Channel</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4">Items</th>
                  <th className="py-3 px-4 text-right">Total</th>
                  <th className="py-3 px-4 text-right">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-surface-50/70 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-surface-900">
                      {ord.orderNumber}
                      <div className="text-[10px] font-normal text-surface-400 font-sans">
                        {formatDate(ord.createdAt)}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-surface-900 leading-tight">
                        {ord.customer?.name || "Walk-in Buyer"}
                      </div>
                      <div className="text-xs text-surface-400">
                        {ord.customer?.phone || ord.customer?.instagramHandle || "—"}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      {getSourceBadge(ord.source)}
                    </td>

                    <td className="py-3.5 px-4">
                      {getStatusBadge(ord.status, ord.requiresApproval)}
                    </td>

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center text-xs font-semibold ${
                          ord.paymentStatus === "PAID"
                            ? "text-emerald-700"
                            : "text-amber-700"
                        }`}
                      >
                        {ord.paymentStatus === "PAID" ? "● Paid" : "○ Unpaid"}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-xs text-surface-600">
                      {ord.items.length} item{ord.items.length !== 1 ? "s" : ""}
                    </td>

                    <td className="py-3.5 px-4 text-right font-bold text-surface-900">
                      {formatCurrency(ord.totalAmount, ord.currency)}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Quick Confirm & Deduct Stock Button */}
                        {(ord.status === "PENDING" || ord.status === "DRAFT") && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleUpdateStatus(ord.id, "CONFIRMED")}
                            disabled={actionLoading === ord.id}
                            className="text-xs h-7 px-2 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                            title="Confirm Order & Deduct Stock"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            <span>Confirm</span>
                          </Button>
                        )}

                        {/* Quick Mark Paid Button */}
                        {ord.paymentStatus !== "PAID" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleUpdatePayment(ord.id, "PAID")}
                            disabled={actionLoading === ord.id}
                            className="text-xs h-7 px-2 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                            title="Mark as Paid"
                          >
                            <DollarSign className="h-3.5 w-3.5 mr-1" />
                            <span>Paid</span>
                          </Button>
                        )}

                        {/* Quick Cancel & Restore Stock */}
                        {ord.status !== "CANCELLED" && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm("Cancel this order and restore product stock?")) {
                                handleUpdateStatus(ord.id, "CANCELLED");
                              }
                            }}
                            disabled={actionLoading === ord.id}
                            title="Cancel Order & Restore Stock"
                            className="rounded p-1.5 text-surface-400 hover:text-rose-600 transition-colors"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setSelectedOrder(ord)}
                          title="View Order Details"
                          className="rounded p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 transition-colors"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-surface-200 bg-surface-50/50 px-4 py-3 text-xs text-surface-500">
              <span>
                Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} orders)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchOrders(pagination.page - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => fetchOrders(pagination.page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Order Details Drawer */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-surface-900/50 backdrop-blur-sm">
          <div className="h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-surface-200 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold font-mono text-surface-900">
                    {selectedOrder.orderNumber}
                  </h3>
                  {getStatusBadge(selectedOrder.status, selectedOrder.requiresApproval)}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-surface-500">Placed {formatDate(selectedOrder.createdAt)} via</span>
                  {getSourceBadge(selectedOrder.source)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="text-surface-400 hover:text-surface-700"
              >
                ✕
              </button>
            </div>

            {/* Social Commerce Attribution & Transaction Room */}
            {selectedOrder.socialTransaction && (
              <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-brand-600" />
                    <span className="font-semibold text-xs text-brand-900">
                      {selectedOrder.socialTransaction.platform} Transaction Room
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-white">
                      {selectedOrder.socialTransaction.surface}
                    </Badge>
                  </div>
                  <a
                    href={`/t/${selectedOrder.socialTransaction.publicTrackingToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
                  >
                    View Room <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="text-[11px] text-brand-800 font-mono">
                  Room Token: {selectedOrder.socialTransaction.publicTrackingToken}
                </div>
              </div>
            )}

            {/* Inventory Status Alert */}
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-3 flex items-center justify-between text-xs">
              <span className="text-surface-600 font-medium">Inventory Stock Status:</span>
              <Badge variant={selectedOrder.stockDeducted ? "success" : "secondary"}>
                {selectedOrder.stockDeducted ? "Stock Deducted" : "Stock Unreserved / Restored"}
              </Badge>
            </div>

            {/* Customer Details */}
            <div className="space-y-2 border-t border-surface-200 pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Customer & Shipping
              </h4>
              <p className="font-semibold text-surface-900">
                {selectedOrder.customer?.name || "Walk-in Buyer"}
              </p>
              <div className="space-y-1 text-xs text-surface-600">
                {selectedOrder.customer?.phone && <div>Phone: {selectedOrder.customer.phone}</div>}
                {selectedOrder.customer?.instagramHandle && <div>Instagram: {selectedOrder.customer.instagramHandle}</div>}
                {selectedOrder.shippingAddress && <div>Address: {selectedOrder.shippingAddress}</div>}
              </div>
            </div>

            {/* Items List */}
            <div className="space-y-3 border-t border-surface-200 pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Ordered Items ({selectedOrder.items.length})
              </h4>
              <div className="divide-y divide-surface-100 rounded-lg border border-surface-200 overflow-hidden">
                {selectedOrder.items.map((itm) => (
                  <div key={itm.id} className="p-3 flex items-center justify-between text-sm bg-white">
                    <div>
                      <div className="font-medium text-surface-900">{itm.title}</div>
                      <div className="text-xs text-surface-400">
                        {itm.variantTitle ? `Variant: ${itm.variantTitle} • ` : ""}
                        {itm.quantity} × {formatCurrency(itm.unitPrice, selectedOrder.currency)}
                      </div>
                    </div>
                    <div className="font-semibold text-surface-900">
                      {formatCurrency(itm.totalPrice, selectedOrder.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Calculation Breakdown */}
            <div className="space-y-2 border-t border-surface-200 pt-4 text-sm">
              <div className="flex justify-between text-surface-600">
                <span>Subtotal:</span>
                <span>{formatCurrency(selectedOrder.subtotal, selectedOrder.currency)}</span>
              </div>
              {selectedOrder.discount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Discount:</span>
                  <span>- {formatCurrency(selectedOrder.discount, selectedOrder.currency)}</span>
                </div>
              )}
              {selectedOrder.shipping > 0 && (
                <div className="flex justify-between text-surface-600">
                  <span>Delivery / Shipping:</span>
                  <span>{formatCurrency(selectedOrder.shipping, selectedOrder.currency)}</span>
                </div>
              )}
              {selectedOrder.tax > 0 && (
                <div className="flex justify-between text-surface-600">
                  <span>Tax:</span>
                  <span>{formatCurrency(selectedOrder.tax, selectedOrder.currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-surface-950 pt-2 border-t border-surface-200">
                <span>Total:</span>
                <span className="text-brand-700">{formatCurrency(selectedOrder.totalAmount, selectedOrder.currency)}</span>
              </div>
            </div>

            {/* Status Change Controls in Drawer */}
            <div className="space-y-3 border-t border-surface-200 pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                Update Order Lifecycle Status
              </h4>
              <div className="flex flex-wrap gap-2">
                {["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"].map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={selectedOrder.status === st ? "default" : "outline"}
                    onClick={() => handleUpdateStatus(selectedOrder.id, st as any)}
                    className="text-xs"
                  >
                    {st}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
