"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShoppingBag,
  Plus,
  Trash2,
  User,
  Instagram,
  MessageSquare,
  ArrowLeft,
  DollarSign,
  Truck,
  CheckCircle2,
  AlertCircle,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ProductItem, CustomerItem } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { trackConversion } from "@/lib/analytics-client";

interface OrderItemRow {
  productId?: string;
  variantId?: string;
  title: string;
  variantTitle?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  availableStock?: number;
}

export default function NewOrderPage() {
  const router = useRouter();

  // Reference Data
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [isLoadingRefs, setIsLoadingRefs] = useState(true);

  // Form State
  const [isExistingCustomer, setIsExistingCustomer] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    email: "",
    instagramHandle: "",
    address: "",
  });

  const [source, setSource] = useState<"MANUAL" | "WHATSAPP" | "INSTAGRAM" | "ONLINE">("WHATSAPP");
  const [status, setStatus] = useState<"PENDING" | "CONFIRMED" | "DRAFT">("CONFIRMED");
  const [paymentStatus, setPaymentStatus] = useState<"PENDING" | "PAID">("PAID");

  // Items
  const [items, setItems] = useState<OrderItemRow[]>([]);

  // Calculation fields
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountType, setDiscountType] = useState<"FIXED" | "PERCENTAGE">("FIXED");
  const [shippingFee, setShippingFee] = useState<number>(0);
  const [taxFee, setTaxFee] = useState<number>(0);

  // Notes
  const [notes, setNotes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<{ id: string; orderNumber: string; total: number } | null>(null);

  // Load products and customers on mount
  useEffect(() => {
    async function loadRefs() {
      setIsLoadingRefs(true);
      try {
        const [prodRes, custRes] = await Promise.all([
          fetch("/api/products?limit=100"),
          fetch("/api/customers?limit=100"),
        ]);
        const prodJson = await prodRes.json();
        const custJson = await custRes.json();

        if (prodJson.success) setProducts(prodJson.data.items);
        if (custJson.success) setCustomers(custJson.data.items);
      } catch {
        // Silently continue
      } finally {
        setIsLoadingRefs(false);
      }
    }
    loadRefs();
  }, []);

  // When existing customer is chosen, prefill shipping address
  const handleSelectCustomer = (id: string) => {
    setSelectedCustomerId(id);
    const found = customers.find((c) => c.id === id);
    if (found?.address) {
      setShippingAddress(found.address);
    }
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        title: "",
        quantity: 1,
        unitPrice: 0,
      },
    ]);
  };

  const handleProductSelect = (index: number, selectionValue: string) => {
    if (!selectionValue) return;

    // Selection format: "prodId" or "prodId:varId"
    const [prodId, varId] = selectionValue.split(":");
    const product = products.find((p) => p.id === prodId);
    if (!product) return;

    let title = product.title;
    let variantTitle = "";
    let sku = product.sku || "";
    let unitPrice = product.price;
    let availableStock = product.stockQuantity;

    if (varId) {
      const variant = product.variants.find((v) => v.id === varId);
      if (variant) {
        variantTitle = variant.title;
        sku = variant.sku || sku;
        unitPrice = variant.price;
        availableStock = variant.stockQuantity;
      }
    }

    setItems((prev) => {
      const updated = [...prev];
      updated[index] = {
        productId: product.id,
        variantId: varId || undefined,
        title,
        variantTitle: variantTitle || undefined,
        sku,
        quantity: 1,
        unitPrice,
        availableStock,
      };
      return updated;
    });
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Calculations
  const subtotal = items.reduce((acc, itm) => acc + itm.quantity * itm.unitPrice, 0);

  let calculatedDiscount = 0;
  if (discountValue > 0) {
    if (discountType === "PERCENTAGE") {
      calculatedDiscount = (subtotal * discountValue) / 100;
    } else {
      calculatedDiscount = Math.min(subtotal, discountValue);
    }
  }

  const finalTotal = Math.max(
    0,
    subtotal - calculatedDiscount + Number(shippingFee || 0) + Number(taxFee || 0)
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (items.length === 0) {
      setErrorMessage("Please add at least one item to the order.");
      return;
    }

    // Check item titles and quantities
    for (const item of items) {
      if (!item.title.trim()) {
        setErrorMessage("All order items must have a name or selected product.");
        return;
      }
      if (item.quantity <= 0) {
        setErrorMessage("Item quantities must be 1 or greater.");
        return;
      }
    }

    // Customer validation
    if (isExistingCustomer && !selectedCustomerId) {
      setErrorMessage("Please select an existing customer or switch to 'New Customer'.");
      return;
    }

    if (!isExistingCustomer && !newCustomer.name.trim()) {
      setErrorMessage("Please enter the new customer's full name.");
      return;
    }

    setIsSubmitting(true);

    const payload = {
      customerId: isExistingCustomer ? selectedCustomerId : null,
      newCustomer: !isExistingCustomer
        ? {
            name: newCustomer.name,
            phone: newCustomer.phone || null,
            email: newCustomer.email || null,
            instagramHandle: newCustomer.instagramHandle || null,
            address: shippingAddress || newCustomer.address || null,
          }
        : null,
      source,
      status,
      paymentStatus,
      discount: discountValue,
      discountType,
      shipping: shippingFee,
      tax: taxFee,
      shippingAddress,
      notes,
      customerNotes,
      requiresApproval: status === "DRAFT",
      items: items.map((itm) => ({
        productId: itm.productId || null,
        variantId: itm.variantId || null,
        title: itm.title,
        variantTitle: itm.variantTitle || null,
        sku: itm.sku || null,
        quantity: itm.quantity,
        unitPrice: itm.unitPrice,
      })),
    };

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to create order");
      }

      setCreatedOrder({
        id: json.data.id,
        orderNumber: json.data.orderNumber,
        total: json.data.total,
      });
      trackConversion("ORDER_CREATED", { orderId: json.data.id });
      setIsSubmitting(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error creating order";
      setErrorMessage(msg);
      setIsSubmitting(false);
    }
  };

  if (createdOrder) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <Card className="border-emerald-200 bg-white shadow-md text-center p-8 space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-surface-900">
              Order Confirmed &amp; Created!
            </h2>
            <p className="text-sm text-surface-600">
              Order <span className="font-mono font-bold text-surface-900">{createdOrder.orderNumber}</span> has been confirmed. Inventory stock has been automatically deducted.
            </p>
          </div>
          <div className="rounded-xl border border-surface-200 bg-surface-50 p-4 max-w-sm mx-auto text-left">
            <div className="flex justify-between text-xs text-surface-500 mb-1">
              <span>Order Number</span>
              <span className="font-mono font-semibold text-surface-900">{createdOrder.orderNumber}</span>
            </div>
            <div className="flex justify-between text-xs text-surface-500">
              <span>Total Amount</span>
              <span className="font-semibold text-emerald-700">{formatCurrency(createdOrder.total)}</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link href="/orders" className="w-full sm:w-auto">
              <Button className="w-full sm:w-auto gap-2">
                <ShoppingBag className="h-4 w-4" />
                <span>Go to Orders List</span>
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => {
                setCreatedOrder(null);
                setItems([]);
                setDiscountValue(0);
                setShippingFee(0);
                setTaxFee(0);
                setNotes("");
                setCustomerNotes("");
              }}
              className="w-full sm:w-auto gap-2"
            >
              <Plus className="h-4 w-4" />
              <span>Create Another Order</span>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Top back link */}
      <div className="flex items-center gap-3">
        <Link
          href="/orders"
          className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 hover:text-surface-900 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
            Create New Order
          </h1>
          <p className="text-xs text-surface-500">
            Manual order entry with live calculations and automated stock adjustment
          </p>
        </div>
      </div>

      {errorMessage && (
        <Alert variant="error" title="Submission Error">
          {errorMessage}
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left Column: Customer & Items */}
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Section */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4 text-surface-500" />
                    Customer Details
                  </CardTitle>
                  <div className="flex rounded-lg border border-surface-200 p-0.5 text-xs bg-surface-50">
                    <button
                      type="button"
                      onClick={() => setIsExistingCustomer(true)}
                      className={`px-3 py-1 rounded-md font-medium transition-colors ${
                        isExistingCustomer
                          ? "bg-white text-surface-900 shadow-sm"
                          : "text-surface-500 hover:text-surface-700"
                      }`}
                    >
                      Existing
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsExistingCustomer(false)}
                      className={`px-3 py-1 rounded-md font-medium transition-colors ${
                        !isExistingCustomer
                          ? "bg-white text-surface-900 shadow-sm"
                          : "text-surface-500 hover:text-surface-700"
                      }`}
                    >
                      + New Customer
                    </button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {isExistingCustomer ? (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-surface-500 mb-1.5">
                      Select Customer *
                    </label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => handleSelectCustomer(e.target.value)}
                      className="w-full rounded-lg border border-surface-300 p-2.5 text-sm text-surface-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                      required
                    >
                      <option value="">-- Choose a registered customer --</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.phone ? `(${c.phone})` : ""} {c.instagramHandle || ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Input
                      label="Customer Name *"
                      placeholder="e.g. Maya Lin"
                      value={newCustomer.name}
                      onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                      required={!isExistingCustomer}
                    />

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Input
                        label="Phone / WhatsApp"
                        placeholder="+1 555 333 4444"
                        value={newCustomer.phone}
                        onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                      />

                      <Input
                        label="Instagram Handle"
                        placeholder="@mayalin"
                        value={newCustomer.instagramHandle}
                        onChange={(e) => setNewCustomer({ ...newCustomer, instagramHandle: e.target.value })}
                      />
                    </div>

                    <Input
                      label="Email Address"
                      type="email"
                      placeholder="maya@example.com"
                      value={newCustomer.email}
                      onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    />
                  </div>
                )}

                <Input
                  label="Dispatch / Shipping Address"
                  placeholder="Street address, city, postal code"
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                />
              </CardContent>
            </Card>

            {/* Order Items Section */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-surface-500" />
                    Products & Items
                  </CardTitle>
                  <CardDescription>
                    Add catalog items with automatic pricing or enter custom line items
                  </CardDescription>
                </div>

                <Button type="button" size="sm" variant="outline" onClick={handleAddItem} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Line Item</span>
                </Button>
              </CardHeader>

              <CardContent className="space-y-4">
                {items.length === 0 ? (
                  <div className="text-center py-8 border border-dashed border-surface-200 rounded-lg bg-surface-50/50">
                    <Package className="h-8 w-8 text-surface-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-surface-700">No items added yet</p>
                    <p className="text-xs text-surface-500 mb-3">Add at least one product to this order</p>
                    <Button type="button" size="sm" onClick={handleAddItem}>
                      Add First Item
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-surface-200 bg-surface-50/70 p-3.5 space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                          {/* Product catalog selector */}
                          <div className="flex-1 w-full sm:w-auto">
                            <label className="block text-[11px] font-semibold uppercase text-surface-500 mb-1">
                              Catalog Product
                            </label>
                            <select
                              onChange={(e) => handleProductSelect(idx, e.target.value)}
                              className="w-full rounded-md border border-surface-300 bg-white p-2 text-xs text-surface-900"
                              defaultValue=""
                            >
                              <option value="">-- Choose from Catalog --</option>
                              {products.map((p) => {
                                if (p.variants.length > 0) {
                                  return (
                                    <optgroup key={p.id} label={`${p.title} (Variants)`}>
                                      {p.variants.map((v) => (
                                        <option key={v.id} value={`${p.id}:${v.id}`}>
                                          {p.title} - {v.title} (${v.price}) [{v.stockQuantity} in stock]
                                        </option>
                                      ))}
                                    </optgroup>
                                  );
                                }
                                return (
                                  <option key={p.id} value={p.id}>
                                    {p.title} (${p.price}) [{p.stockQuantity} in stock]
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          <div className="flex-1 w-full sm:w-auto">
                            <Input
                              label="Item Name / Title *"
                              placeholder="Silk scarf or custom item"
                              value={item.title}
                              onChange={(e) => {
                                const newItems = [...items];
                                newItems[idx].title = e.target.value;
                                setItems(newItems);
                              }}
                              required
                            />
                          </div>

                          <div className="w-24">
                            <Input
                              label="Qty *"
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => {
                                const newItems = [...items];
                                newItems[idx].quantity = Math.max(1, parseInt(e.target.value, 10) || 1);
                                setItems(newItems);
                              }}
                              required
                            />
                          </div>

                          <div className="w-28">
                            <Input
                              label="Unit Price ($) *"
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.unitPrice}
                              onChange={(e) => {
                                const newItems = [...items];
                                newItems[idx].unitPrice = Math.max(0, parseFloat(e.target.value) || 0);
                                setItems(newItems);
                              }}
                              required
                            />
                          </div>

                          <div className="pt-5 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="rounded p-2 text-surface-400 hover:text-rose-600 transition-colors"
                              title="Delete Item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {/* Line Item Total & Variant badge */}
                        <div className="flex items-center justify-between text-xs text-surface-500 pt-1 border-t border-surface-200">
                          <div className="flex items-center gap-2">
                            {item.variantTitle && (
                              <Badge variant="secondary" className="text-[10px]">
                                Variant: {item.variantTitle}
                              </Badge>
                            )}
                            {item.sku && <span className="font-mono">SKU: {item.sku}</span>}
                            {item.availableStock !== undefined && (
                              <span className={item.availableStock > 0 ? "text-emerald-700" : "text-rose-600 font-medium"}>
                                Available Stock: {item.availableStock}
                              </span>
                            )}
                          </div>
                          <div>
                            Line Total: <strong className="text-surface-900 font-bold">{formatCurrency(item.quantity * item.unitPrice)}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Order Source, Status & Live Financial Calculator */}
          <div className="space-y-6">
            {/* Channels & Status Card */}
            <Card className="border-surface-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Order Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase text-surface-500 mb-1">
                    Sales Channel
                  </label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as any)}
                    className="w-full rounded-lg border border-surface-300 p-2 text-sm text-surface-900"
                  >
                    <option value="WHATSAPP">WhatsApp Conversation</option>
                    <option value="INSTAGRAM">Instagram Direct</option>
                    <option value="MANUAL">Direct / Phone / Walk-in</option>
                    <option value="ONLINE">Online Store</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-surface-500 mb-1">
                    Order Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full rounded-lg border border-surface-300 p-2 text-sm text-surface-900"
                  >
                    <option value="CONFIRMED">Confirmed (Auto-deducts Stock)</option>
                    <option value="PENDING">Pending Approval (Stock Held)</option>
                    <option value="DRAFT">Draft Order</option>
                  </select>
                  <p className="text-[11px] text-surface-400 mt-1">
                    {status === "CONFIRMED"
                      ? "Confirmed orders immediately deduct stock quantities from inventory."
                      : "Pending/draft orders keep inventory unaffected until confirmed."}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-surface-500 mb-1">
                    Payment Status
                  </label>
                  <select
                    value={paymentStatus}
                    onChange={(e) => setPaymentStatus(e.target.value as any)}
                    className="w-full rounded-lg border border-surface-300 p-2 text-sm text-surface-900"
                  >
                    <option value="PAID">Paid in Full</option>
                    <option value="PENDING">Payment Pending / COD</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Automatic Pricing Calculator */}
            <Card className="border-surface-200 shadow-sm bg-gradient-to-b from-surface-50/50 to-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  Order Calculator
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-surface-600">
                    <span>Subtotal:</span>
                    <span className="font-semibold text-surface-900">{formatCurrency(subtotal)}</span>
                  </div>

                  {/* Discount input */}
                  <div className="pt-2 border-t border-surface-200">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-surface-600">Discount:</span>
                      <div className="flex rounded border border-surface-300 text-[11px] bg-white">
                        <button
                          type="button"
                          onClick={() => setDiscountType("FIXED")}
                          className={`px-1.5 py-0.5 ${discountType === "FIXED" ? "bg-brand-50 text-brand-700 font-bold" : "text-surface-500"}`}
                        >
                          $
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiscountType("PERCENTAGE")}
                          className={`px-1.5 py-0.5 ${discountType === "PERCENTAGE" ? "bg-brand-50 text-brand-700 font-bold" : "text-surface-500"}`}
                        >
                          %
                        </button>
                      </div>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                    />
                    {calculatedDiscount > 0 && (
                      <p className="text-[11px] text-emerald-600 text-right mt-0.5">
                        - {formatCurrency(calculatedDiscount)}
                      </p>
                    )}
                  </div>

                  {/* Shipping input */}
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">
                      Delivery / Shipping Fee ($):
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={shippingFee}
                      onChange={(e) => setShippingFee(parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  {/* Tax input */}
                  <div>
                    <label className="block text-xs font-medium text-surface-600 mb-1">
                      Tax ($):
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={taxFee}
                      onChange={(e) => setTaxFee(parseFloat(e.target.value) || 0)}
                    />
                  </div>

                  {/* Final Total */}
                  <div className="pt-3 border-t border-surface-300 flex items-center justify-between text-base font-bold text-surface-950">
                    <span>Total Amount:</span>
                    <span className="text-xl text-brand-700">{formatCurrency(finalTotal)}</span>
                  </div>
                </div>

                <Button type="submit" size="lg" className="w-full mt-4" isLoading={isSubmitting}>
                  Complete & Create Order
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
