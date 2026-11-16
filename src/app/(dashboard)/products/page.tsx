"use client";

import { useEffect, useState } from "react";
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  RefreshCw,
  Edit2,
  Trash2,
  Layers,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductItem, ProductVariantItem } from "@/types";
import { formatCurrency } from "@/lib/utils";

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [lowStockFilter, setLowStockFilter] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    title: "",
    sku: "",
    category: "",
    description: "",
    price: 0,
    costPrice: 0,
    stockQuantity: 0,
    lowStockThreshold: 5,
    trackInventory: true,
    status: "ACTIVE" as const,
    variants: [] as { id?: string; title: string; sku?: string; price: number; costPrice?: number; stockQuantity: number }[],
  });

  const fetchProducts = async (page = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: "20",
      });
      if (search) params.set("search", search);
      if (lowStockFilter) params.set("lowStock", "true");
      if (selectedStatus !== "ALL") params.set("status", selectedStatus);

      const res = await fetch(`/api/products?${params.toString()}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load products");
      }

      setProducts(json.data.items);
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
      fetchProducts(1);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, lowStockFilter, selectedStatus]);

  const openCreateModal = () => {
    setEditingProduct(null);
    setFormData({
      title: "",
      sku: "",
      category: "",
      description: "",
      price: 0,
      costPrice: 0,
      stockQuantity: 0,
      lowStockThreshold: 5,
      trackInventory: true,
      status: "ACTIVE",
      variants: [],
    });
    setIsModalOpen(true);
  };

  const openEditModal = (product: ProductItem) => {
    setEditingProduct(product);
    setFormData({
      title: product.title,
      sku: product.sku || "",
      category: product.category || "",
      description: product.description || "",
      price: product.price,
      costPrice: product.costPrice || 0,
      stockQuantity: product.stockQuantity,
      lowStockThreshold: product.lowStockThreshold,
      trackInventory: product.trackInventory,
      status: product.status as any,
      variants: product.variants.map((v) => ({
        id: v.id,
        title: v.title,
        sku: v.sku || "",
        price: v.price,
        costPrice: v.costPrice || 0,
        stockQuantity: v.stockQuantity,
      })),
    });
    setIsModalOpen(true);
  };

  const handleAddVariant = () => {
    setFormData((prev) => ({
      ...prev,
      variants: [
        ...prev.variants,
        {
          title: `Variant ${prev.variants.length + 1}`,
          sku: prev.sku ? `${prev.sku}-V${prev.variants.length + 1}` : "",
          price: prev.price,
          costPrice: prev.costPrice,
          stockQuantity: 0,
        },
      ],
    }));
  };

  const handleRemoveVariant = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      variants: prev.variants.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const url = editingProduct ? `/api/products/${editingProduct.id}` : "/api/products";
      const method = editingProduct ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save product");
      }

      setIsModalOpen(false);
      fetchProducts(pagination.page);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving product";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error);
      fetchProducts(pagination.page);
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
            Inventory & Products
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Catalog management, product variants, price controls, and real-time stock counts
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchProducts(pagination.page)}
            isLoading={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </Button>

          <Button size="sm" onClick={openCreateModal} className="gap-1.5">
            <Plus className="h-4 w-4" />
            <span>Add Product</span>
          </Button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <Alert variant="error" title="Error">
          {error}
        </Alert>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3 max-w-md">
          <Input
            placeholder="Search products by title, SKU, or category..."
            leftIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={lowStockFilter ? "destructive" : "outline"}
            onClick={() => setLowStockFilter(!lowStockFilter)}
            className="gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Low Stock Only</span>
          </Button>

          <div className="flex rounded-lg border border-surface-200 bg-white p-1 text-xs">
            {["ALL", "ACTIVE", "DRAFT", "ARCHIVED"].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setSelectedStatus(status)}
                className={`rounded px-2.5 py-1 font-medium transition-colors ${
                  selectedStatus === status
                    ? "bg-brand-50 text-brand-700 font-semibold"
                    : "text-surface-600 hover:text-surface-900"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading Skeletons */}
      {isLoading && products.length === 0 && (
        <Card className="p-6">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      )}

      {/* Products Table */}
      {!isLoading && products.length === 0 ? (
        <EmptyState
          icon={<Package className="h-6 w-6" />}
          title="No products found"
          description={
            lowStockFilter
              ? "All products have sufficient stock! No low stock alerts."
              : "Add products to your catalog with prices and inventory tracking."
          }
          action={
            <Button size="sm" onClick={openCreateModal}>
              Add Product
            </Button>
          }
        />
      ) : (
        products.length > 0 && (
          <Card className="border-surface-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-surface-200 bg-surface-50/70 text-xs font-semibold uppercase tracking-wider text-surface-500">
                  <tr>
                    <th className="py-3 px-4">Product</th>
                    <th className="py-3 px-4">SKU / Variants</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Price</th>
                    <th className="py-3 px-4">Stock</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-50/70 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-surface-900 leading-tight">
                          {p.title}
                        </div>
                        {p.category && (
                          <div className="text-xs text-surface-400 mt-0.5">
                            Category: {p.category}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {p.variants.length > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary" className="gap-1">
                              <Layers className="h-3 w-3" />
                              <span>{p.variants.length} Variants</span>
                            </Badge>
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-surface-500">
                            {p.sku || "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <Badge
                          variant={
                            p.status === "ACTIVE"
                              ? "success"
                              : p.status === "DRAFT"
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-surface-900">
                        {formatCurrency(p.price)}
                      </td>
                      <td className="py-3.5 px-4">
                        {p.trackInventory ? (
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-semibold ${
                                p.isOutOfStock
                                  ? "text-rose-600"
                                  : p.isLowStock
                                  ? "text-amber-600"
                                  : "text-emerald-700"
                              }`}
                            >
                              {p.stockQuantity} in stock
                            </span>
                            {p.isOutOfStock && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                Out
                              </Badge>
                            )}
                            {p.isLowStock && (
                              <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                                Low
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-surface-400">Untracked</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            title="Edit Product"
                            className="rounded p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 transition-colors"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(p.id)}
                            title="Delete Product"
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

            {/* Pagination footer */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-surface-200 bg-surface-50/50 px-4 py-3 text-xs text-surface-500">
                <span>
                  Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} products)
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pagination.page <= 1}
                    onClick={() => fetchProducts(pagination.page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => fetchProducts(pagination.page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )
      )}

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-900/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl border border-surface-200 my-8">
            <div className="flex items-center justify-between border-b border-surface-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-surface-900">
                {editingProduct ? "Edit Product" : "Add New Product"}
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
              <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="Product Title *"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                  />

                  <Input
                    label="Base SKU"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input
                    label="Price ($) *"
                    type="number"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                    required
                  />

                  <Input
                    label="Cost Price ($)"
                    type="number"
                    step="0.01"
                    value={formData.costPrice}
                    onChange={(e) => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })}
                  />

                  <Input
                    label="Base Stock Units"
                    type="number"
                    value={formData.stockQuantity}
                    onChange={(e) => setFormData({ ...formData, stockQuantity: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label="Category"
                    placeholder="e.g. Apparel, Accessories"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  />

                  <Input
                    label="Low Stock Alert Threshold"
                    type="number"
                    value={formData.lowStockThreshold}
                    onChange={(e) => setFormData({ ...formData, lowStockThreshold: parseInt(e.target.value, 10) || 5 })}
                    helperText="Alerts when stock drops to or below this number"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="trackInventory"
                    checked={formData.trackInventory}
                    onChange={(e) => setFormData({ ...formData, trackInventory: e.target.checked })}
                    className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="trackInventory" className="text-sm text-surface-700 font-medium">
                    Track Inventory and Deduct Stock on Order Confirmation
                  </label>
                </div>

                {/* Variants Manager */}
                <div className="border-t border-surface-200 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-surface-900">
                        Product Variants
                      </h4>
                      <p className="text-xs text-surface-500">
                        Add options like Sizes (S, M, L) or Colors with dedicated stock counts
                      </p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={handleAddVariant}>
                      + Add Variant
                    </Button>
                  </div>

                  {formData.variants.length > 0 && (
                    <div className="space-y-3">
                      {formData.variants.map((v, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-200 bg-surface-50 p-3"
                        >
                          <div className="flex-1 min-w-[140px]">
                            <Input
                              placeholder="Variant (e.g. Size M / Black)"
                              value={v.title}
                              onChange={(e) => {
                                const newVars = [...formData.variants];
                                newVars[idx].title = e.target.value;
                                setFormData({ ...formData, variants: newVars });
                              }}
                              required
                            />
                          </div>

                          <div className="w-24">
                            <Input
                              placeholder="SKU"
                              value={v.sku || ""}
                              onChange={(e) => {
                                const newVars = [...formData.variants];
                                newVars[idx].sku = e.target.value;
                                setFormData({ ...formData, variants: newVars });
                              }}
                            />
                          </div>

                          <div className="w-24">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Price"
                              value={v.price}
                              onChange={(e) => {
                                const newVars = [...formData.variants];
                                newVars[idx].price = parseFloat(e.target.value) || 0;
                                setFormData({ ...formData, variants: newVars });
                              }}
                            />
                          </div>

                          <div className="w-20">
                            <Input
                              type="number"
                              placeholder="Stock"
                              value={v.stockQuantity}
                              onChange={(e) => {
                                const newVars = [...formData.variants];
                                newVars[idx].stockQuantity = parseInt(e.target.value, 10) || 0;
                                setFormData({ ...formData, variants: newVars });
                              }}
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveVariant(idx)}
                            className="rounded p-1 text-surface-400 hover:text-rose-600"
                            title="Remove variant"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-surface-200 bg-surface-50/50 px-6 py-4 rounded-b-xl">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isSaving}>
                  {editingProduct ? "Save Changes" : "Create Product"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
