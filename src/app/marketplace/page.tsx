"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  ShieldCheck,
  Star,
  Store,
  ShoppingBag,
  Globe,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

interface MarketplaceProductItem {
  listingId: string;
  productId: string;
  businessId: string;
  title: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  priceMinorUnits: number;
  currency: string;
  inStock: boolean;
  stockQuantity: number;
  reviewAverage: number;
  reviewCount: number;
  seller: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    city: string | null;
    countryCode: string | null;
    verificationTier: string;
    fulfillmentRate: number;
  };
  rankingFactors: {
    explainableScore: number;
    exactTitleMatch: boolean;
    prefixTitleMatch: boolean;
    inStock: boolean;
    verifiedSeller: boolean;
    fulfillmentRatePercent: number;
    sponsored: boolean;
  };
}

export default function MarketplacePage() {
  const [query, setQuery] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [items, setItems] = useState<MarketplaceProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick checkout state
  const [selectedProduct, setSelectedProduct] = useState<MarketplaceProductItem | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [countryCode, setCountryCode] = useState("US");
  const [submittingCheckout, setSubmittingCheckout] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{
    orderNumber: string;
    trackingToken: string | null;
  } | null>(null);

  const fetchListings = async (overrideQuery?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = overrideQuery !== undefined ? overrideQuery : query;
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (verifiedOnly) params.set("verifiedOnly", "true");
      if (inStockOnly) params.set("inStockOnly", "true");
      const res = await fetch(`/api/marketplace/search?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load marketplace listings");
      }
      setItems(json.data.items || []);
    } catch (err: any) {
      setError(err.message || "Unable to fetch marketplace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchListings("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedOnly, inStockOnly]);

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    setSubmittingCheckout(true);
    setError(null);
    try {
      const res = await fetch("/api/marketplace/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.productId,
          quantity: 1,
          buyerEmail: buyerEmail.trim() || undefined,
          shippingAddress: {
            name: buyerName.trim(),
            addressLine1: addressLine1.trim(),
            city: city.trim(),
            countryCode: countryCode.trim().toUpperCase() || "US",
          },
          paymentProvider: "MANUAL",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Checkout failed");
      }
      setCheckoutResult({
        orderNumber: json.data.orderNumber,
        trackingToken: json.data.trackingToken,
      });
      setSelectedProduct(null);
    } catch (err: any) {
      setError(err.message || "Checkout could not be completed");
    } finally {
      setSubmittingCheckout(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-50">
      <header className="border-b border-surface-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white font-bold">
              OF
            </div>
            <div>
              <h1 className="text-base font-bold text-surface-950">OrderFlow Network Discovery</h1>
              <p className="text-xs text-surface-500">
                Opted-in independent merchants with verified fulfillment and transaction-backed reviews
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/buyer/dashboard">
              <Button variant="outline" size="sm">Buyer Portal</Button>
            </Link>
            <Link href="/dashboard">
              <Button size="sm">Seller Workspace</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-6">
        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchListings();
              }}
              className="flex flex-1 gap-2"
            >
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products, brands, categories, or verified sellers..."
                leftIcon={<Search className="h-4 w-4" />}
              />
              <Button type="submit">Search</Button>
            </form>
            <div className="flex items-center gap-4 text-xs text-surface-700">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                />
                Verified Sellers Only
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inStockOnly}
                  onChange={(e) => setInStockOnly(e.target.checked)}
                />
                In Stock Only
              </label>
            </div>
          </CardContent>
        </Card>

        {error && <Alert variant="error" title="Notice">{error}</Alert>}

        {checkoutResult && (
          <Alert variant="success" title="Order Created via Unified OrderFlow Checkout">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>Order #{checkoutResult.orderNumber} has a verifiable Transaction Room ready.</span>
              {checkoutResult.trackingToken && (
                <Link href={`/t/${encodeURIComponent(checkoutResult.trackingToken)}`}>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    Open Transaction Room <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              )}
            </div>
          </Alert>
        )}

        {selectedProduct && (
          <Card className="border-brand-300 bg-white">
            <CardHeader>
              <CardTitle>Checkout: {selectedProduct.title}</CardTitle>
              <CardDescription>
                Sold by {selectedProduct.seller.name} ({selectedProduct.currency}{" "}
                {(selectedProduct.priceMinorUnits / 100).toFixed(2)})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCheckoutSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label="Full Name"
                  required
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                />
                <Input
                  label="Email (optional for receipt)"
                  type="email"
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                />
                <Input
                  label="Shipping Address"
                  required
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label="City"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                  <Input
                    label="Country (ISO-2)"
                    required
                    maxLength={2}
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setSelectedProduct(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={submittingCheckout}>
                    Create Verifiable Order
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="text-sm text-surface-500 py-12 text-center">Loading network listings...</div>
        ) : items.length === 0 ? (
          <Card className="p-10 text-center">
            <Store className="h-8 w-8 text-surface-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-surface-900">No discoverable listings found</p>
            <p className="text-xs text-surface-500 mt-1">
              Sellers must explicitly opt in to discovery to appear in OrderFlow Network Search.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <Card key={item.productId} className="flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <Badge variant={item.inStock ? "success" : "secondary"}>
                      {item.inStock ? "In Stock" : "Out of Stock"}
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-1.5 text-xs">
                    <Globe className="h-3.5 w-3.5" />
                    <span>{item.seller.name}</span>
                    {item.seller.verificationTier !== "UNVERIFIED" && (
                      <Badge variant="default" className="gap-1 py-0 text-[10px]">
                        <ShieldCheck className="h-3 w-3" /> {item.seller.verificationTier.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-bold text-surface-950">
                      {item.currency} {(item.priceMinorUnits / 100).toFixed(2)}
                    </span>
                    <div className="flex items-center gap-1 text-xs text-surface-600">
                      <Star className="h-3.5 w-3.5 text-amber-500" />
                      <span>
                        {item.reviewCount > 0
                          ? `${item.reviewAverage.toFixed(1)} (${item.reviewCount})`
                          : "No reviews yet"}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-50 p-2.5 text-[11px] text-surface-600 space-y-1">
                    <div className="flex items-center gap-1 font-medium text-surface-800">
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      Fulfillment Rate: {item.seller.fulfillmentRate.toFixed(1)}%
                    </div>
                    <div>
                      Score {item.rankingFactors.explainableScore} — zero paid placement.
                    </div>
                  </div>
                  <Button
                    className="w-full gap-1.5"
                    disabled={!item.inStock}
                    onClick={() => setSelectedProduct(item)}
                  >
                    <ShoppingBag className="h-4 w-4" />
                    Checkout via OrderFlow
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
