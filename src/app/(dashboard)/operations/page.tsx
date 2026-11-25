"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  Truck,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Scale,
  BookOpen,
  Settings2,
  AlertTriangle,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, formatMinorUnitsCurrency } from "@/lib/utils";

type OperationsTab = "PAYMENTS" | "FULFILLMENT" | "RETURNS" | "REFUNDS" | "RECONCILIATION" | "LEDGER" | "PROVIDERS";

export default function OperationsPage() {
  const [activeTab, setActiveTab] = useState<OperationsTab>("PAYMENTS");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Domain state
  const [intents, setIntents] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [shipments, setShipments] = useState<any[]>([]);
  const [returnsList, setReturnsList] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([]);
  const [ledgerHealth, setLedgerHealth] = useState<any | null>(null);
  const [configs, setConfigs] = useState<any[]>([]);

  // Provider form
  const [provForm, setProvForm] = useState({
    provider: "RAZORPAY",
    environment: "sandbox",
    accountIdentifier: "",
    keyId: "",
    keySecret: "",
    webhookSecret: "",
  });

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [intRes, payRes, shipRes, retRes, refRes, recRes, ledRes, ledHealthRes, cfgRes] =
        await Promise.all([
          fetch("/api/payments/intents?limit=25"),
          fetch("/api/payments?limit=25"),
          fetch("/api/shipments?limit=25"),
          fetch("/api/returns?limit=25"),
          fetch("/api/refunds?limit=25"),
          fetch("/api/reconciliation?limit=10"),
          fetch("/api/ledger?limit=30"),
          fetch("/api/ledger?validate=true"),
          fetch("/api/provider-config"),
        ]);

      const [intJson, payJson, shipJson, retJson, refJson, recJson, ledJson, ledHealthJson, cfgJson] =
        await Promise.all([
          intRes.json(),
          payRes.json(),
          shipRes.json(),
          retRes.json(),
          refRes.json(),
          recRes.json(),
          ledRes.json(),
          ledHealthRes.json(),
          cfgRes.json(),
        ]);

      if (intJson.success) setIntents(intJson.data?.items || []);
      if (payJson.success) setPayments(payJson.data?.items || []);
      if (shipJson.success) setShipments(shipJson.data?.items || []);
      if (retJson.success) setReturnsList(retJson.data?.items || []);
      if (refJson.success) setRefunds(refJson.data?.items || []);
      if (recJson.success) setRuns(recJson.data?.items || []);
      if (ledJson.success) setLedgerEntries(ledJson.data?.items || []);
      if (ledHealthJson.success) setLedgerHealth(ledHealthJson.data);
      if (cfgJson.success) setConfigs(cfgJson.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load commerce operations data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleVerifyPayment = async (paymentId: string, action: "VERIFY" | "REJECT") => {
    setBusyId(paymentId);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/payments/${paymentId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Action failed");
      setActionMsg(`Payment ${action === "VERIFY" ? "verified & posted to ledger" : "rejected"}`);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCaptureIntent = async (intentId: string) => {
    setBusyId(intentId);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/payments/intents/${intentId}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `ui-cap-${intentId}-${Date.now()}` }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Capture failed");
      setActionMsg("Payment intent captured and recorded on double-entry ledger.");
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleGenerateLabel = async (shipmentId: string) => {
    setBusyId(shipmentId);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/shipments/${shipmentId}/tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "GENERATE_LABEL" }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Label generation failed");
      setActionMsg(`Shipping label ${json.data.labelReference} generated.`);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReturnTransition = async (returnId: string, status: string, extra?: any) => {
    setBusyId(returnId);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/returns/${returnId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to update return");
      setActionMsg(`Return updated to ${status}`);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReceiveAndRefundReturn = async (returnId: string) => {
    setBusyId(returnId);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/returns/${returnId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspectionPassed: true,
          inspectionNotes: "Inspected and approved in operations portal",
          restockInventory: true,
          issueRefund: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Inspection failed");
      setActionMsg("Return received, inspected, restocked, and refund initiated.");
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleRunReconciliation = async (type: "PAYMENT" | "REFUND" | "SHIPMENT") => {
    setBusyId(`rec-${type}`);
    setActionMsg(null);
    try {
      const res = await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Reconciliation failed");
      setSelectedRun(json.data);
      setActionMsg(`${type} reconciliation complete: ${json.data.matchedCount} matched, ${json.data.mismatchCount} discrepancies.`);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleViewRun = async (runId: string) => {
    try {
      const res = await fetch(`/api/reconciliation/${runId}`);
      const json = await res.json();
      if (json.success) setSelectedRun(json.data);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResolveDiscrepancy = async (runId: string, entryId: string) => {
    setBusyId(entryId);
    try {
      const res = await fetch(`/api/reconciliation/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId,
          resolutionNotes: "Reviewed and reconciled by merchant operator",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Resolve failed");
      await handleViewRun(runId);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveProviderConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId("save-provider");
    setActionMsg(null);
    try {
      const res = await fetch("/api/provider-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provForm.provider,
          environment: provForm.environment,
          enabled: true,
          accountIdentifier: provForm.accountIdentifier || null,
          credentials: {
            ...(provForm.keyId ? { keyId: provForm.keyId } : {}),
            ...(provForm.keySecret ? { keySecret: provForm.keySecret } : {}),
            ...(provForm.webhookSecret ? { webhookSecret: provForm.webhookSecret } : {}),
          },
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Save failed");
      setActionMsg(`${provForm.provider} (${provForm.environment}) credentials encrypted and saved.`);
      setProvForm({ ...provForm, keyId: "", keySecret: "", webhookSecret: "" });
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const pendingPayments = payments.filter((p) => p.status === "PENDING_VERIFICATION");
  const openReturns = returnsList.filter((r) => ["REQUESTED", "APPROVED", "IN_TRANSIT", "RECEIVED"].includes(r.status));
  const unresolvedRec = runs.reduce((acc, r) => acc + (r.unresolvedCount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
            Commerce Operations
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Payment intents, logistics tracking, returns & refunds, append-only ledger, and reconciliation
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={loadAll}
          isLoading={loading}
          className="gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-surface-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-surface-500">Pending Payment Proof</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">{pendingPayments.length}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Wallet className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-surface-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-surface-500">Active Shipments</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">
                {shipments.filter((s) => s.status !== "DELIVERED" && s.status !== "CANCELLED").length}
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Truck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-surface-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-surface-500">Active Returns</p>
              <p className="text-2xl font-bold text-surface-900 mt-1">{openReturns.length}</p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <RotateCcw className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-surface-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-surface-500">Ledger & Recon Status</p>
              <p className="text-sm font-bold text-emerald-700 mt-1">
                {ledgerHealth?.valid === false
                  ? "Ledger Violation!"
                  : unresolvedRec > 0
                  ? `${unresolvedRec} Discrepancies`
                  : "All Balanced & Matched"}
              </p>
            </div>
            <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Alert variant="error" title="Error">
          {error}
        </Alert>
      )}
      {actionMsg && (
        <Alert variant="success" title="Updated">
          {actionMsg}
        </Alert>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-surface-200 pb-3">
        {[
          { id: "PAYMENTS", label: "Payments & Intents", icon: Wallet },
          { id: "FULFILLMENT", label: "Fulfillment & Tracking", icon: Truck },
          { id: "RETURNS", label: "Returns", icon: RotateCcw },
          { id: "REFUNDS", label: "Refunds", icon: RefreshCw },
          { id: "RECONCILIATION", label: "Reconciliation", icon: Scale },
          { id: "LEDGER", label: "Financial Ledger", icon: BookOpen },
          { id: "PROVIDERS", label: "Payment Gateways", icon: Settings2 },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as OperationsTab)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-surface-600 hover:bg-surface-100 hover:text-surface-900"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {loading && intents.length === 0 && payments.length === 0 ? (
        <Card className="p-6 space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Card>
      ) : (
        <>
          {/* PAYMENTS TAB */}
          {activeTab === "PAYMENTS" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Payment Intents</CardTitle>
                  <CardDescription className="text-xs">
                    Gateway and manual payment intents with attempt tracking & idempotency
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {intents.length === 0 ? (
                    <p className="text-xs text-surface-500">No payment intents created yet.</p>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-surface-200 text-surface-500 uppercase">
                        <tr>
                          <th className="py-2 pr-4">Order</th>
                          <th className="py-2 pr-4">Provider</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2 pr-4">Amount</th>
                          <th className="py-2 pr-4">Captured</th>
                          <th className="py-2 pr-4">Refunded</th>
                          <th className="py-2 pr-4">Attempts</th>
                          <th className="py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {intents.map((pi) => (
                          <tr key={pi.id}>
                            <td className="py-2.5 pr-4 font-mono font-semibold">
                              {pi.order?.orderNumber || pi.orderId.slice(0, 8)}
                            </td>
                            <td className="py-2.5 pr-4">{pi.provider}</td>
                            <td className="py-2.5 pr-4">
                              <Badge variant={pi.status === "CAPTURED" ? "success" : "warning"}>
                                {pi.status}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-4 font-semibold">
                              {formatMinorUnitsCurrency(pi.amountMinorUnits, pi.currency)}
                            </td>
                            <td className="py-2.5 pr-4">
                              {formatMinorUnitsCurrency(pi.capturedMinorUnits, pi.currency)}
                            </td>
                            <td className="py-2.5 pr-4">
                              {formatMinorUnitsCurrency(pi.refundedMinorUnits, pi.currency)}
                            </td>
                            <td className="py-2.5 pr-4">{pi.attempts?.length || 0}</td>
                            <td className="py-2.5 text-right">
                              {pi.status === "AUTHORIZED" && (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  isLoading={busyId === pi.id}
                                  onClick={() => handleCaptureIntent(pi.id)}
                                >
                                  Capture
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recorded Payments & Verification Queue</CardTitle>
                  <CardDescription className="text-xs">
                    Buyer-submitted proofs and verified settlements
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {payments.length === 0 ? (
                    <p className="text-xs text-surface-500">No payment records found.</p>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-surface-200 text-surface-500 uppercase">
                        <tr>
                          <th className="py-2 pr-4">Order</th>
                          <th className="py-2 pr-4">Method</th>
                          <th className="py-2 pr-4">Reference</th>
                          <th className="py-2 pr-4">Amount</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {payments.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 pr-4 font-mono font-semibold">
                              {p.order?.orderNumber || p.orderId.slice(0, 8)}
                            </td>
                            <td className="py-2.5 pr-4">{p.method}</td>
                            <td className="py-2.5 pr-4 font-mono">{p.referenceNumber || "—"}</td>
                            <td className="py-2.5 pr-4 font-semibold">
                              {formatCurrency(p.amount, p.currency)}
                            </td>
                            <td className="py-2.5 pr-4">
                              <Badge
                                variant={
                                  p.status === "VERIFIED"
                                    ? "success"
                                    : p.status === "REJECTED"
                                    ? "destructive"
                                    : "warning"
                                }
                              >
                                {p.status}
                              </Badge>
                            </td>
                            <td className="py-2.5 text-right space-x-1.5">
                              {p.status === "PENDING_VERIFICATION" && (
                                <>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={busyId === p.id}
                                    onClick={() => handleVerifyPayment(p.id, "VERIFY")}
                                  >
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Verify
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-rose-600"
                                    disabled={busyId === p.id}
                                    onClick={() => handleVerifyPayment(p.id, "REJECT")}
                                  >
                                    <XCircle className="h-3 w-3 mr-1" /> Reject
                                  </Button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* FULFILLMENT TAB */}
          {activeTab === "FULFILLMENT" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Shipments & Logistics Normalization</CardTitle>
                <CardDescription className="text-xs">
                  Carrier tracking numbers, label generation, and delivery exception visibility
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {shipments.length === 0 ? (
                  <p className="text-xs text-surface-500">No shipments created yet.</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-surface-200 text-surface-500 uppercase">
                      <tr>
                        <th className="py-2 pr-4">Order</th>
                        <th className="py-2 pr-4">Carrier</th>
                        <th className="py-2 pr-4">Tracking #</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Created</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {shipments.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2.5 pr-4 font-mono font-semibold">
                            {s.order?.orderNumber || s.orderId.slice(0, 8)}
                          </td>
                          <td className="py-2.5 pr-4">{s.carrier}</td>
                          <td className="py-2.5 pr-4 font-mono">{s.trackingNumber || "—"}</td>
                          <td className="py-2.5 pr-4">
                            <Badge
                              variant={
                                s.status === "DELIVERED"
                                  ? "success"
                                  : ["FAILED_ATTEMPT", "LOST", "DAMAGED", "CANCELLED"].includes(s.status)
                                  ? "destructive"
                                  : "default"
                              }
                            >
                              {s.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 pr-4">{formatDate(s.createdAt)}</td>
                          <td className="py-2.5 text-right">
                            {(s.status === "CREATED" || s.status === "PENDING") && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1"
                                disabled={busyId === s.id}
                                onClick={() => handleGenerateLabel(s.id)}
                              >
                                <FileCheck2 className="h-3 w-3" /> Generate Label
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {/* RETURNS TAB */}
          {activeTab === "RETURNS" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Return Authorizations & Inspections</CardTitle>
                <CardDescription className="text-xs">
                  Structured return reasons, eligibility verification, receiving & automatic refund release
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {returnsList.length === 0 ? (
                  <p className="text-xs text-surface-500">No return requests submitted yet.</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-surface-200 text-surface-500 uppercase">
                      <tr>
                        <th className="py-2 pr-4">Order</th>
                        <th className="py-2 pr-4">Reason</th>
                        <th className="py-2 pr-4">Requested Amt</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Tracking</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {returnsList.map((r) => (
                        <tr key={r.id}>
                          <td className="py-2.5 pr-4 font-mono font-semibold">
                            {r.order?.orderNumber || r.orderId.slice(0, 8)}
                          </td>
                          <td className="py-2.5 pr-4">{r.reason.replace(/_/g, " ")}</td>
                          <td className="py-2.5 pr-4 font-semibold">
                            {formatMinorUnitsCurrency(r.requestedAmountMinorUnits, r.currency)}
                          </td>
                          <td className="py-2.5 pr-4">
                            <Badge
                              variant={
                                r.status === "REFUNDED"
                                  ? "success"
                                  : r.status === "REJECTED" || r.status === "CANCELLED"
                                  ? "destructive"
                                  : "warning"
                              }
                            >
                              {r.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 pr-4 font-mono">{r.trackingNumber || "—"}</td>
                          <td className="py-2.5 text-right space-x-1.5">
                            {r.status === "REQUESTED" && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={busyId === r.id}
                                  onClick={() =>
                                    handleReturnTransition(r.id, "APPROVED", {
                                      sellerResponse: "Return approved by seller",
                                    })
                                  }
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-rose-600"
                                  disabled={busyId === r.id}
                                  onClick={() =>
                                    handleReturnTransition(r.id, "REJECTED", {
                                      sellerResponse: "Return denied after policy review",
                                    })
                                  }
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                            {["APPROVED", "LABEL_CREATED", "IN_TRANSIT"].includes(r.status) && (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={busyId === r.id}
                                onClick={() => handleReceiveAndRefundReturn(r.id)}
                              >
                                Receive & Refund
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {/* REFUNDS TAB */}
          {activeTab === "REFUNDS" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Refunds History</CardTitle>
                <CardDescription className="text-xs">
                  Idempotent refund executions synchronized with ledger & payment intents
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {refunds.length === 0 ? (
                  <p className="text-xs text-surface-500">No refunds recorded yet.</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-surface-200 text-surface-500 uppercase">
                      <tr>
                        <th className="py-2 pr-4">Order</th>
                        <th className="py-2 pr-4">Type</th>
                        <th className="py-2 pr-4">Amount</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Provider Ref</th>
                        <th className="py-2 pr-4">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {refunds.map((rf) => (
                        <tr key={rf.id}>
                          <td className="py-2.5 pr-4 font-mono font-semibold">
                            {rf.order?.orderNumber || rf.orderId.slice(0, 8)}
                          </td>
                          <td className="py-2.5 pr-4">{rf.type}</td>
                          <td className="py-2.5 pr-4 font-semibold">
                            {formatMinorUnitsCurrency(rf.amountMinorUnits, rf.currency)}
                          </td>
                          <td className="py-2.5 pr-4">
                            <Badge variant={rf.status === "COMPLETED" ? "success" : "warning"}>
                              {rf.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 pr-4 font-mono">{rf.providerRefundId || "—"}</td>
                          <td className="py-2.5 pr-4 text-surface-600">{rf.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {/* RECONCILIATION TAB */}
          {activeTab === "RECONCILIATION" && (
            <div className="space-y-6">
              <Card>
                <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Reconciliation Engine</CardTitle>
                    <CardDescription className="text-xs">
                      Compare internal ledger & state against observed payment and carrier webhooks
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["PAYMENT", "REFUND", "SHIPMENT"] as const).map((t) => (
                      <Button
                        key={t}
                        size="sm"
                        variant="outline"
                        className="text-xs h-8"
                        isLoading={busyId === `rec-${t}`}
                        onClick={() => handleRunReconciliation(t)}
                      >
                        Run {t} Recon
                      </Button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  {runs.length === 0 ? (
                    <p className="text-xs text-surface-500">No reconciliation runs executed yet.</p>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-surface-200 text-surface-500 uppercase">
                        <tr>
                          <th className="py-2 pr-4">Type</th>
                          <th className="py-2 pr-4">Total</th>
                          <th className="py-2 pr-4">Matched</th>
                          <th className="py-2 pr-4">Mismatches</th>
                          <th className="py-2 pr-4">Unresolved</th>
                          <th className="py-2 pr-4">Run At</th>
                          <th className="py-2 text-right">Inspect</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {runs.map((run) => (
                          <tr key={run.id}>
                            <td className="py-2.5 pr-4 font-semibold">{run.type}</td>
                            <td className="py-2.5 pr-4">{run.totalRecords}</td>
                            <td className="py-2.5 pr-4 text-emerald-700 font-semibold">{run.matchedCount}</td>
                            <td className="py-2.5 pr-4 text-amber-700 font-semibold">{run.mismatchCount}</td>
                            <td className="py-2.5 pr-4">{run.unresolvedCount}</td>
                            <td className="py-2.5 pr-4">{formatDate(run.createdAt)}</td>
                            <td className="py-2.5 text-right">
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => handleViewRun(run.id)}>
                                Details
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>

              {selectedRun && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Reconciliation Entries ({selectedRun.type})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(selectedRun.entries || []).map((e: any) => (
                      <div
                        key={e.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-surface-200 p-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2 font-semibold">
                            <Badge variant={e.status === "MATCHED" ? "success" : "warning"}>
                              {e.status}
                            </Badge>
                            <span>{e.internalEntityType || "EXTERNAL"}</span>
                            <span className="font-mono text-surface-500">
                              {e.internalEntityId?.slice(0, 8) || e.providerEntityId}
                            </span>
                          </div>
                          <p className="text-surface-600 mt-1">{e.notes}</p>
                        </div>
                        {!e.resolved && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs shrink-0"
                            disabled={busyId === e.id}
                            onClick={() => handleResolveDiscrepancy(selectedRun.id, e.id)}
                          >
                            Mark Resolved
                          </Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* LEDGER TAB */}
          {activeTab === "LEDGER" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Immutable Financial Ledger</CardTitle>
                  <CardDescription className="text-xs">
                    Append-only double-entry journal in integer minor units
                  </CardDescription>
                </div>
                {ledgerHealth && (
                  <Badge variant={ledgerHealth.valid ? "success" : "destructive"}>
                    {ledgerHealth.valid
                      ? `Double-Entry Balanced (${ledgerHealth.totalDebitsMinorUnits} == ${ledgerHealth.totalCreditsMinorUnits})`
                      : `${ledgerHealth.violations?.length || 0} Violation(s)`}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {ledgerEntries.length === 0 ? (
                  <p className="text-xs text-surface-500">No ledger entries posted yet.</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-surface-200 text-surface-500 uppercase">
                      <tr>
                        <th className="py-2 pr-4">Order</th>
                        <th className="py-2 pr-4">Type</th>
                        <th className="py-2 pr-4">Account</th>
                        <th className="py-2 pr-4">Direction</th>
                        <th className="py-2 pr-4">Amount</th>
                        <th className="py-2 pr-4">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {ledgerEntries.map((le) => (
                        <tr key={le.id}>
                          <td className="py-2 pr-4 font-mono font-semibold">
                            {le.order?.orderNumber || le.orderId.slice(0, 8)}
                          </td>
                          <td className="py-2 pr-4">{le.entryType}</td>
                          <td className="py-2 pr-4 font-mono">{le.account}</td>
                          <td className="py-2 pr-4">
                            <Badge variant={le.direction === "CREDIT" ? "success" : "outline"}>
                              {le.direction}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4 font-semibold">
                            {formatMinorUnitsCurrency(le.amountMinorUnits, le.currency)}
                          </td>
                          <td className="py-2 pr-4 text-surface-600">{le.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}

          {/* PROVIDERS TAB */}
          {activeTab === "PROVIDERS" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Connected Payment Providers</CardTitle>
                  <CardDescription className="text-xs">
                    Credentials are encrypted at rest via AES-256-GCM and never exposed back to the browser
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {configs.length === 0 ? (
                    <p className="text-xs text-surface-500">No external payment providers configured yet.</p>
                  ) : (
                    configs.map((cfg) => (
                      <div key={cfg.id} className="rounded-lg border border-surface-200 p-3 flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold text-surface-900">
                            {cfg.provider} ({cfg.environment})
                          </div>
                          <div className="text-surface-500 mt-0.5">
                            Account: {cfg.accountIdentifier || "Default"} • Keys stored:{" "}
                            {cfg.hasCredentials ? "Encrypted" : "None"}
                          </div>
                        </div>
                        <Badge variant={cfg.enabled ? "success" : "secondary"}>{cfg.status}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Configure Payment Provider</CardTitle>
                  <CardDescription className="text-xs">
                    Add or rotate sandbox/live API & webhook credentials
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSaveProviderConfig} className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium text-surface-700 mb-1">Provider</label>
                        <select
                          value={provForm.provider}
                          onChange={(e) => setProvForm({ ...provForm, provider: e.target.value })}
                          className="w-full rounded-lg border border-surface-300 px-2.5 py-1.5"
                        >
                          <option value="RAZORPAY">Razorpay</option>
                          <option value="STRIPE">Stripe</option>
                          <option value="MANUAL">Manual</option>
                          <option value="OTHER">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block font-medium text-surface-700 mb-1">Environment</label>
                        <select
                          value={provForm.environment}
                          onChange={(e) => setProvForm({ ...provForm, environment: e.target.value })}
                          className="w-full rounded-lg border border-surface-300 px-2.5 py-1.5"
                        >
                          <option value="sandbox">Sandbox</option>
                          <option value="live">Live</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block font-medium text-surface-700 mb-1">Account Identifier</label>
                      <input
                        type="text"
                        placeholder="acct_... or merchant ID"
                        value={provForm.accountIdentifier}
                        onChange={(e) => setProvForm({ ...provForm, accountIdentifier: e.target.value })}
                        className="w-full rounded-lg border border-surface-300 px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-surface-700 mb-1">API Key ID</label>
                      <input
                        type="text"
                        placeholder="rzp_test_... / pk_test_..."
                        value={provForm.keyId}
                        onChange={(e) => setProvForm({ ...provForm, keyId: e.target.value })}
                        className="w-full rounded-lg border border-surface-300 px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-surface-700 mb-1">API Secret</label>
                      <input
                        type="password"
                        placeholder="Stored encrypted"
                        value={provForm.keySecret}
                        onChange={(e) => setProvForm({ ...provForm, keySecret: e.target.value })}
                        className="w-full rounded-lg border border-surface-300 px-2.5 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-surface-700 mb-1">Webhook Signing Secret</label>
                      <input
                        type="password"
                        placeholder="whsec_... / razorpay webhook secret"
                        value={provForm.webhookSecret}
                        onChange={(e) => setProvForm({ ...provForm, webhookSecret: e.target.value })}
                        className="w-full rounded-lg border border-surface-300 px-2.5 py-1.5"
                      />
                    </div>
                    <Button type="submit" size="sm" isLoading={busyId === "save-provider"}>
                      Save Encrypted Credentials
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
