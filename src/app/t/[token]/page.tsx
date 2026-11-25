"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck,
  Package,
  Truck,
  CreditCard,
  AlertTriangle,
  Clock,
  Instagram,
  MessageSquare,
  ExternalLink,
  ChevronRight,
  CheckCircle2,
  RefreshCw,
  ShoppingBag,
  Send,
  AlertCircle,
} from "lucide-react";
import { PublicTransactionResponse } from "@/types";
import { TransactionTimeline } from "@/components/transactions/TransactionTimeline";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";

export default function PublicTransactionRoomPage() {
  const params = useParams();
  const token = params?.token as string;

  const [data, setData] = useState<PublicTransactionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dispute submission form state
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeNotes, setDisputeNotes] = useState("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [disputeSuccess, setDisputeSuccess] = useState<string | null>(null);
  const [disputeError, setDisputeError] = useState<string | null>(null);

  // Evidence submission state
  const [evidenceDisputeId, setEvidenceDisputeId] = useState<string | null>(null);
  const [evidenceMediaUrl, setEvidenceMediaUrl] = useState("");
  const [evidenceNotes, setEvidenceNotes] = useState("");
  const [isSubmittingEvidence, setIsSubmittingEvidence] = useState(false);
  const [evidenceSuccess, setEvidenceSuccess] = useState<string | null>(null);

  // Buyer session & claim state
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) setCurrentUser(d.user);
      })
      .catch(() => {});
  }, []);

  const handleClaimTransaction = async () => {
    setIsClaiming(true);
    setClaimError(null);
    setClaimSuccess(null);
    try {
      const res = await fetch("/api/buyer/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to claim purchase");
      setClaimSuccess("This transaction has been successfully claimed to your universal OrderFlow account!");
      await fetchTransaction();
    } catch (err: any) {
      setClaimError(err.message);
    } finally {
      setIsClaiming(false);
    }
  };

  const fetchTransaction = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/transactions/${encodeURIComponent(token)}`);
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.error || "Unable to load transaction room");
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
    if (token) {
      fetchTransaction();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleDisputeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeReason.trim()) return;

    setIsSubmittingDispute(true);
    setDisputeError(null);
    setDisputeSuccess(null);

    try {
      const res = await fetch(`/api/public/transactions/${encodeURIComponent(token)}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: disputeReason.trim(),
          buyerNotes: disputeNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to submit dispute");
      }

      setDisputeSuccess("Your dispute/return request has been submitted to the seller.");
      setDisputeReason("");
      setDisputeNotes("");
      setShowDisputeForm(false);
      // Refresh timeline
      await fetchTransaction();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Submission error";
      setDisputeError(msg);
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  const handleEvidenceSubmit = async (disputeId: string) => {
    if (!evidenceNotes.trim() && !evidenceMediaUrl.trim()) {
      alert("Please provide either notes or an evidence URL");
      return;
    }
    setIsSubmittingEvidence(true);
    try {
      const res = await fetch(`/api/disputes/${disputeId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidenceType: "DISPUTE_EVIDENCE",
          actor: "BUYER",
          source: "TRANSACTION_ROOM",
          trackingToken: token,
          mediaUrl: evidenceMediaUrl.trim() || undefined,
          notes: evidenceNotes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to submit evidence");
      setEvidenceSuccess(`Evidence submitted with content hash: ${json.data?.evidence?.contentHash?.slice(0, 16)}...`);
      setEvidenceDisputeId(null);
      setEvidenceMediaUrl("");
      setEvidenceNotes("");
      fetchTransaction();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmittingEvidence(false);
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case "INSTAGRAM":
        return <Instagram className="h-4 w-4 text-pink-600" />;
      case "WHATSAPP":
        return <MessageSquare className="h-4 w-4 text-emerald-600" />;
      case "FACEBOOK":
        return <span className="h-4 w-4 rounded-full bg-blue-600 text-[10px] font-bold text-white flex items-center justify-center leading-none">f</span>;
      case "X":
        return <span className="h-4 w-4 rounded-full bg-slate-900 text-[10px] font-bold text-white flex items-center justify-center leading-none">𝕏</span>;
      default:
        return <ShoppingBag className="h-4 w-4 text-brand-600" />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 py-10 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-surface-200 p-8 text-center">
          <div className="h-12 w-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-surface-900">Transaction Not Found</h2>
          <p className="mt-2 text-sm text-surface-500">
            {error || "The requested transaction link is invalid or may have expired."}
          </p>
          <div className="mt-6">
            <Button onClick={fetchTransaction} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" /> Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Top Branding Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-sm shadow-sm">
              OF
            </div>
            <span className="text-xs font-semibold tracking-wide uppercase text-surface-500">
              Verified Social Transaction
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Live Sync
          </div>
        </div>

        {/* Dispute status alert if active */}
        {disputeSuccess && (
          <Alert variant="success" title="Request Submitted">
            {disputeSuccess}
          </Alert>
        )}

        {/* Phase 3: Universal Buyer Identity Claim Banner */}
        <Card className="border-brand-200 bg-brand-50/40 shadow-xs">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-xs text-surface-900">
                  {claimSuccess
                    ? "Purchase Connected to Your OrderFlow Identity"
                    : currentUser
                    ? "Save to Your OrderFlow Universal Account"
                    : "Track All Your Social Purchases in One Place"}
                </div>
                <div className="text-[11px] text-surface-500">
                  {claimSuccess
                    ? "This transaction is permanently linked to your profile."
                    : currentUser
                    ? `Logged in as ${currentUser.email}. Consolidate this transaction with your other purchases.`
                    : "Have an OrderFlow account? Sign in to save this purchase and track updates."}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {claimSuccess ? (
                <Link href="/buyer/dashboard">
                  <Button size="sm" variant="outline" className="text-xs h-8">
                    View in Dashboard
                  </Button>
                </Link>
              ) : currentUser ? (
                <Button
                  size="sm"
                  onClick={handleClaimTransaction}
                  isLoading={isClaiming}
                  className="text-xs h-8 gap-1.5"
                >
                  Save to My Account
                </Button>
              ) : (
                <Link href={`/login?redirect=/t/${encodeURIComponent(token)}`}>
                  <Button size="sm" variant="outline" className="text-xs h-8">
                    Sign In to Claim
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
          {claimError && (
            <div className="px-4 pb-3 text-xs text-red-600">
              {claimError}
            </div>
          )}
        </Card>

        {/* 1. Seller Trust Card */}
        <Card className="border-surface-200 shadow-sm overflow-hidden bg-white">
          <div className="bg-gradient-to-r from-surface-900 to-surface-800 p-6 text-white">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white font-bold text-xl border border-white/20 shadow-inner">
                  {data.seller.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.seller.logoUrl}
                      alt={data.seller.name}
                      className="h-full w-full rounded-2xl object-cover"
                    />
                  ) : (
                    data.seller.name.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold">{data.seller.name}</h1>
                    {data.seller.metrics?.isVerifiedSeller && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 border border-emerald-400/30">
                        <ShieldCheck className="h-3 w-3" /> Verified Merchant
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-surface-300 mt-0.5 flex items-center gap-2">
                    <span>Origin:</span>
                    <span className="inline-flex items-center gap-1 font-medium text-white">
                      {getPlatformIcon(data.platform)} {data.platform} ({data.surface.replace(/_/g, " ")})
                    </span>
                  </p>
                </div>
              </div>

              {/* Factual Trust Indicators */}
              <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-white/15 pt-3 sm:pt-0 sm:pl-4 text-xs">
                <div>
                  <div className="text-base font-bold text-white">
                    {data.seller.metrics?.deliveryFulfillmentRate}%
                  </div>
                  <div className="text-[11px] text-surface-300">Fulfillment Rate</div>
                </div>
                <div>
                  <div className="text-base font-bold text-white">
                    {data.seller.metrics?.completedOrdersCount}+
                  </div>
                  <div className="text-[11px] text-surface-300">Orders Delivered</div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* 2. Canonical Order & Payment Card */}
          {/* Delivery Confirmation Form (Guest) */}
          {(!data.order?.shippingAddress) && (
            <Card className="border-surface-200 shadow-sm mt-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Confirm Delivery Information</CardTitle>
                <CardDescription className="text-xs">Provide shipping address to finalize your order.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget as HTMLFormElement;
                    const formData = new FormData(form);
                    const payload = {
                      recipientName: formData.get('recipientName'),
                      phone: formData.get('phone'),
                      email: formData.get('email'),
                      shippingAddress: formData.get('shippingAddress'),
                      city: formData.get('city'),
                      state: formData.get('state'),
                      postalCode: formData.get('postalCode'),
                      notes: formData.get('notes'),
                    };
                    setIsLoading(true);
                    try {
                      const res = await fetch(`/api/public/transactions/${encodeURIComponent(token)}/confirm-delivery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      const json = await res.json();
                      if (!res.ok || !json.success) throw new Error(json.error || 'Delivery confirmation failed');
                      await fetchTransaction();
                    } catch (err) {
                      alert(err instanceof Error ? err.message : 'Error');
                    } finally { setIsLoading(false); }
                  }}
                >
                  <div className="grid gap-2">
                    <input name="recipientName" placeholder="Recipient Name" required className="w-full rounded-md border p-2" />
                    <input name="phone" placeholder="Phone (optional)" className="w-full rounded-md border p-2" />
                    <input name="email" placeholder="Email (optional)" type="email" className="w-full rounded-md border p-2" />
                    <input name="shippingAddress" placeholder="Street address" required className="w-full rounded-md border p-2" />
                    <input name="city" placeholder="City" required className="w-full rounded-md border p-2" />
                    <input name="state" placeholder="State/Region" className="w-full rounded-md border p-2" />
                    <input name="postalCode" placeholder="Postal Code" className="w-full rounded-md border p-2" />
                    <textarea name="notes" placeholder="Additional notes (optional)" className="w-full rounded-md border p-2" rows={2} />
                  </div>
                  <Button type="submit" className="mt-3" disabled={isLoading}>Confirm Delivery</Button>
                </form>
              </CardContent>
            </Card>
          )}
          
          {/* Payment Proof Form (Guest) */}
          {data.order?.paymentStatus !== 'PAID' && (
            <Card className="border-surface-200 shadow-sm mt-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Submit Payment Proof</CardTitle>
                <CardDescription className="text-xs">Upload a screenshot or reference number for your payment.</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget as HTMLFormElement;
                    const formData = new FormData(form);
                    const payload = {
                      amount: formData.get('amount'),
                      method: formData.get('method'),
                      referenceNumber: formData.get('referenceNumber'),
                      screenshotUrl: formData.get('screenshotUrl'),
                      notes: formData.get('notes'),
                    };
                    setIsLoading(true);
                    try {
                      const res = await fetch(`/api/public/transactions/${encodeURIComponent(token)}/payment-proof`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      const json = await res.json();
                      if (!res.ok || !json.success) throw new Error(json.error || 'Payment proof submission failed');
                      await fetchTransaction();
                    } catch (err) {
                      alert(err instanceof Error ? err.message : 'Error');
                    } finally { setIsLoading(false); }
                  }}
                >
                  <div className="grid gap-2">
                    <input name="amount" placeholder="Amount (e.g., 49.99)" required type="number" step="0.01" className="w-full rounded-md border p-2" />
                    <select name="method" required className="w-full rounded-md border p-2">
                      <option value="">Select method</option>
                      <option value="BANK_TRANSFER">Bank Transfer</option>
                      <option value="UPI">UPI</option>
                      <option value="CREDIT_CARD">Credit Card</option>
                    </select>
                    <input name="referenceNumber" placeholder="Reference / Transaction ID" required className="w-full rounded-md border p-2" />
                    <input name="screenshotUrl" placeholder="Screenshot URL (optional)" className="w-full rounded-md border p-2" />
                    <textarea name="notes" placeholder="Additional notes (optional)" className="w-full rounded-md border p-2" rows={2} />
                  </div>
                  <Button type="submit" className="mt-3" disabled={isLoading}>Submit Proof</Button>
                </form>
              </CardContent>
            </Card>
          )}
          
          {/* Existing Order Card continues below */}
        {data.order && (
          <Card className="border-surface-200 shadow-sm">
            <CardHeader className="border-b border-surface-100 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-surface-400">Order Reference</div>
                  <CardTitle className="text-lg font-mono text-surface-900">
                    {data.order.orderNumber}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={data.order.paymentStatus === "PAID" ? "success" : "warning"}>
                    {data.order.paymentStatus}
                  </Badge>
                  <Badge variant="default">
                    {data.order.status}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {/* Items List */}
              <div className="divide-y divide-surface-100">
                {data.order.items.map((item, idx) => (
                  <div key={idx} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium text-surface-900">{item.title}</div>
                      {item.variantTitle && (
                        <div className="text-xs text-surface-500">Variant: {item.variantTitle}</div>
                      )}
                      <div className="text-xs text-surface-400">Qty: {item.quantity} × {data.order?.currency} {item.unitPrice}</div>
                    </div>
                    <div className="font-semibold text-surface-900">
                      {data.order?.currency} {item.totalPrice}
                    </div>
                  </div>
                ))}
              </div>

              {/* Total Summary */}
              <div className="pt-3 border-t border-surface-200 flex items-center justify-between font-bold text-base text-surface-950">
                <span>Total Amount</span>
                <span>{data.order.currency} {data.order.totalAmount}</span>
              </div>

              {/* Shipping Destination */}
              {data.order.shippingAddress && (
                <div className="rounded-lg bg-surface-50 p-3 text-xs text-surface-600 border border-surface-200">
                  <span className="font-semibold text-surface-900">Shipping To: </span>
                  {data.order.shippingAddress}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 3. Live Logistics Tracking */}
        {data.order?.shipment && (
          <Card className="border-surface-200 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <Truck className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">Live Shipment Tracking</CardTitle>
                    <CardDescription className="text-xs">
                      Carrier: {data.order.shipment.carrier}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="default">{data.order.shipment.status}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {data.order.shipment.trackingNumber ? (
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-50 border border-surface-200">
                  <div>
                    <div className="text-[11px] text-surface-400">Tracking / AWB Number</div>
                    <div className="font-mono font-medium text-surface-900">
                      {data.order.shipment.trackingNumber}
                    </div>
                  </div>
                  {data.order.shipment.trackingUrl && (
                    <a
                      href={data.order.shipment.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      Track on Carrier Site <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-xs text-surface-500">
                  Carrier dispatch booked. Tracking details will update automatically once scanned by the courier.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* 4. Public Timeline */}
        <Card className="border-surface-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Transaction Activity & Timeline</CardTitle>
            <CardDescription className="text-xs">
              Cryptographically verified chronological milestones
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TransactionTimeline events={data.timeline} />
          </CardContent>
        </Card>

        {/* 5. Returns & Dispute Gateway */}
        <Card className="border-surface-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold">Need Help with this Order?</CardTitle>
                <CardDescription className="text-xs">
                  Request a return, exchange, or submit a dispute to the seller
                </CardDescription>
              </div>
              {!showDisputeForm && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowDisputeForm(true)}
                  className="gap-1 text-xs"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  Initiate Return / Dispute
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {showDisputeForm ? (
              <form onSubmit={handleDisputeSubmit} className="space-y-4 pt-2">
                {disputeError && (
                  <Alert variant="error" title="Submission Failed">
                    {disputeError}
                  </Alert>
                )}
                <div>
                  <label className="block text-xs font-medium text-surface-700 mb-1">
                    Reason for Return / Dispute *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Wrong size delivered, damaged item, not as described"
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    className="w-full rounded-md border border-surface-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-700 mb-1">
                    Additional Details
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Explain what happened so the seller can resolve this quickly..."
                    value={disputeNotes}
                    onChange={(e) => setDisputeNotes(e.target.value)}
                    className="w-full rounded-md border border-surface-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowDisputeForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    isLoading={isSubmittingDispute}
                    className="gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" /> Submit Request
                  </Button>
                </div>
              </form>
            ) : (
              <div className="text-xs text-surface-500">
                All transactions on OrderFlow are protected by canonical event tracking. If you receive a wrong or damaged item, you can initiate a dispute directly from this room.
              </div>
            )}

            {/* Display active disputes if any */}
            {data.disputes && data.disputes.length > 0 && (
              <div className="mt-4 space-y-3 border-t border-surface-100 pt-3">
                <h5 className="text-xs font-semibold text-surface-900">Submitted Disputes:</h5>
                {evidenceSuccess && (
                  <Alert variant="success" title="Evidence Added">
                    {evidenceSuccess}
                  </Alert>
                )}
                {data.disputes.map((d) => (
                  <div key={d.id} className="p-3 rounded-lg bg-amber-50/60 border border-amber-200 text-xs space-y-2">
                    <div className="flex items-center justify-between font-semibold text-amber-900">
                      <span>Reason: {d.reason}</span>
                      <Badge variant="warning">{d.status}</Badge>
                    </div>
                    {d.sellerResponse && (
                      <div className="text-surface-700">
                        <span className="font-semibold text-surface-900">Seller Response: </span>
                        {d.sellerResponse}
                      </div>
                    )}
                    {evidenceDisputeId === d.id ? (
                      <div className="pt-2 border-t border-amber-200/60 space-y-2">
                        <div className="font-semibold text-amber-950">Add Supporting Evidence</div>
                        <input
                          type="url"
                          placeholder="Image / Document URL (optional)"
                          value={evidenceMediaUrl}
                          onChange={(e) => setEvidenceMediaUrl(e.target.value)}
                          className="w-full rounded-md border border-amber-300 p-1.5 text-xs bg-white"
                        />
                        <textarea
                          placeholder="Describe the issue or evidence..."
                          rows={2}
                          value={evidenceNotes}
                          onChange={(e) => setEvidenceNotes(e.target.value)}
                          className="w-full rounded-md border border-amber-300 p-1.5 text-xs bg-white"
                        />
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEvidenceDisputeId(null)}
                            className="text-xs h-7"
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleEvidenceSubmit(d.id)}
                            isLoading={isSubmittingEvidence}
                            className="text-xs h-7"
                          >
                            Upload Evidence
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-end pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEvidenceDisputeId(d.id);
                            setEvidenceSuccess(null);
                          }}
                          className="text-xs h-7 border-amber-300 text-amber-900 hover:bg-amber-100"
                        >
                          Attach Evidence
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-surface-400 py-4">
          Powered by <span className="font-semibold text-surface-600">OrderFlow</span> • The Transaction Operating System for Social Commerce
        </div>
      </div>
    </div>
  );
}
