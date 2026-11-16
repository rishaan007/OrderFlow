"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Plus,
  Search,
  RefreshCw,
  Phone,
  Mail,
  Instagram,
  ShoppingBag,
  Edit2,
  Trash2,
  Eye,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CustomerItem } from "@/types";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "totalSpent" | "ordersCount" | "name">("createdAt");

  // Add / Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Customer Profile Details Drawer
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerItem | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    instagramHandle: "",
    address: "",
    city: "",
    notes: "",
    tags: "" as string, // Comma-separated in UI
  });

  const fetchCustomers = async (page = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
        sortBy,
        sortOrder: "desc",
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/customers?${params.toString()}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load customers");
      }

      setCustomers(json.data.items);
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
      fetchCustomers(1);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sortBy]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    setFormData({
      name: "",
      phone: "",
      email: "",
      instagramHandle: "",
      address: "",
      city: "",
      notes: "",
      tags: "",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (c: CustomerItem) => {
    setEditingCustomer(c);
    setFormData({
      name: c.name,
      phone: c.phone || "",
      email: c.email || "",
      instagramHandle: c.instagramHandle || "",
      address: c.address || "",
      city: c.city || "",
      notes: c.notes || "",
      tags: c.tags.join(", "),
    });
    setIsModalOpen(true);
  };

  const openCustomerProfile = async (id: string) => {
    setIsLoadingProfile(true);
    try {
      const res = await fetch(`/api/customers/${id}`);
      const json = await res.json();
      if (json.success) {
        setSelectedCustomer(json.data);
      }
    } catch {
      alert("Failed to load customer profile");
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    const payload = {
      name: formData.name,
      phone: formData.phone || null,
      email: formData.email || null,
      instagramHandle: formData.instagramHandle || null,
      address: formData.address || null,
      city: formData.city || null,
      notes: formData.notes || null,
      tags: formData.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    try {
      const url = editingCustomer ? `/api/customers/${editingCustomer.id}` : "/api/customers";
      const method = editingCustomer ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save customer");
      }

      setIsModalOpen(false);
      fetchCustomers(pagination.page);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving customer";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this customer record?")) return;

    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error);
      fetchCustomers(pagination.page);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
            Customer Directory (CRM)
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Customer profiles, order frequency, Instagram/WhatsApp contacts, and lifetime value
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchCustomers(pagination.page)}
            isLoading={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </Button>

          <Button size="sm" onClick={openCreateModal} className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span>Add Customer</span>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Error">
          {error}
        </Alert>
      )}

      {/* Search & Sort Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3 max-w-md">
          <Input
            placeholder="Search by name, phone, email, or @instagram..."
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-500 font-medium">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-9 rounded-lg border border-surface-300 bg-white px-3 py-1 text-xs font-medium text-surface-700"
          >
            <option value="createdAt">Recently Added</option>
            <option value="totalSpent">Highest Lifetime Spend</option>
            <option value="ordersCount">Most Orders Placed</option>
            <option value="name">Name (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Customers List */}
      {isLoading && customers.length === 0 ? (
        <Card className="p-6">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : customers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No customers recorded"
          description="Create manual customer profiles or let them accumulate automatically as orders arrive."
          action={
            <Button size="sm" onClick={openCreateModal}>
              Add First Customer
            </Button>
          }
        />
      ) : (
        <Card className="border-surface-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-200 bg-surface-50/70 text-xs font-semibold uppercase tracking-wider text-surface-500">
                <tr>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Tags</th>
                  <th className="py-3 px-4">Orders</th>
                  <th className="py-3 px-4">Total Spent</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-surface-50/70 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-surface-900 leading-tight">
                        {c.name}
                      </div>
                      {c.city && (
                        <div className="text-xs text-surface-400 mt-0.5">
                          {c.city}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="space-y-0.5 text-xs">
                        {c.phone && (
                          <div className="flex items-center gap-1.5 text-surface-600">
                            <Phone className="h-3 w-3 text-surface-400" />
                            <span>{c.phone}</span>
                          </div>
                        )}
                        {c.instagramHandle && (
                          <div className="flex items-center gap-1.5 text-pink-600 font-medium">
                            <Instagram className="h-3 w-3" />
                            <span>{c.instagramHandle}</span>
                          </div>
                        )}
                        {c.email && (
                          <div className="flex items-center gap-1.5 text-surface-500">
                            <Mail className="h-3 w-3 text-surface-400" />
                            <span>{c.email}</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.length > 0 ? (
                          c.tags.map((t, idx) => (
                            <span
                              key={idx}
                              className="rounded bg-surface-100 border border-surface-200 px-1.5 py-0.5 text-[11px] font-medium text-surface-700"
                            >
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-surface-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-surface-800">
                      {c.ordersCount}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-surface-900">
                      {formatCurrency(c.totalSpent)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openCustomerProfile(c.id)}
                          title="View Profile & Orders"
                          className="rounded p-1.5 text-surface-400 hover:bg-surface-100 hover:text-brand-600 transition-colors"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(c)}
                          title="Edit Customer"
                          className="rounded p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 transition-colors"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          title="Delete Customer"
                          className="rounded p-1.5 text-surface-400 hover:bg-surface-100 hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
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
                Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} customers)
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchCustomers(pagination.page - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => fetchCustomers(pagination.page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Add / Edit Customer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-surface-200 my-8">
            <div className="flex items-center justify-between border-b border-surface-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-surface-900">
                {editingCustomer ? "Edit Customer Profile" : "Add New Customer"}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-surface-400 hover:text-surface-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                <Input
                  label="Full Name *"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="Phone / WhatsApp"
                    placeholder="+1 555 123 4567"
                    leftIcon={<Phone className="h-4 w-4" />}
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />

                  <Input
                    label="Instagram Handle"
                    placeholder="@username"
                    leftIcon={<Instagram className="h-4 w-4 text-pink-600" />}
                    value={formData.instagramHandle}
                    onChange={(e) => setFormData({ ...formData, instagramHandle: e.target.value })}
                  />
                </div>

                <Input
                  label="Email Address"
                  type="email"
                  placeholder="customer@example.com"
                  leftIcon={<Mail className="h-4 w-4" />}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="City / Region"
                    placeholder="New York"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  />

                  <Input
                    label="Tags (comma-separated)"
                    placeholder="VIP, Wholesale, Regular"
                    leftIcon={<Tag className="h-4 w-4" />}
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  />
                </div>

                <Input
                  label="Delivery Address"
                  placeholder="Street address, Apt, Suite"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />

                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1">
                    Merchant Notes
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Customer preferences, sizing notes, special delivery instructions..."
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full rounded-lg border border-surface-300 p-2.5 text-sm text-surface-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-surface-200 bg-surface-50/50 px-6 py-4 rounded-b-xl">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isSaving}>
                  {editingCustomer ? "Save Changes" : "Create Customer"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Profile Drawer */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-surface-900/50 backdrop-blur-sm">
          <div className="h-full w-full max-w-xl bg-white shadow-2xl overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-surface-200 pb-4">
              <div>
                <h3 className="text-xl font-bold text-surface-900">
                  {selectedCustomer.name}
                </h3>
                <p className="text-xs text-surface-500">
                  Customer since {formatDate(selectedCustomer.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="text-surface-400 hover:text-surface-700"
              >
                ✕
              </button>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-surface-200 bg-surface-50 p-4">
                <p className="text-xs font-semibold uppercase text-surface-500">Total Spent</p>
                <p className="text-2xl font-bold text-surface-950 mt-1">
                  {formatCurrency(selectedCustomer.totalSpent)}
                </p>
              </div>
              <div className="rounded-lg border border-surface-200 bg-surface-50 p-4">
                <p className="text-xs font-semibold uppercase text-surface-500">Total Orders</p>
                <p className="text-2xl font-bold text-surface-950 mt-1">
                  {selectedCustomer.ordersCount}
                </p>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-3 border-t border-surface-200 pt-4">
              <h4 className="text-sm font-semibold text-surface-900">Contact Information</h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-surface-500">Phone:</span>
                  <span className="font-medium">{selectedCustomer.phone || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-surface-500">Instagram:</span>
                  <span className="font-medium text-pink-600">{selectedCustomer.instagramHandle || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-surface-500">Email:</span>
                  <span className="font-medium">{selectedCustomer.email || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-surface-500">Address:</span>
                  <span className="font-medium">{selectedCustomer.address || "—"}</span>
                </div>
              </div>
            </div>

            {/* Order History */}
            <div className="space-y-3 border-t border-surface-200 pt-4">
              <h4 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                <span>Order History</span>
              </h4>

              {selectedCustomer.orders && selectedCustomer.orders.length > 0 ? (
                <div className="divide-y divide-surface-100">
                  {selectedCustomer.orders.map((ord) => (
                    <div key={ord.id} className="py-3 flex items-center justify-between">
                      <div>
                        <div className="font-mono text-xs font-bold text-surface-900">
                          {ord.orderNumber}
                        </div>
                        <div className="text-xs text-surface-400 mt-0.5">
                          {formatDate(ord.createdAt)} • {ord.items.length} items
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-surface-900">
                          {formatCurrency(ord.totalAmount)}
                        </div>
                        <Badge
                          variant={ord.status === "CONFIRMED" ? "success" : "secondary"}
                          className="text-[10px]"
                        >
                          {ord.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-surface-400">No past orders recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
