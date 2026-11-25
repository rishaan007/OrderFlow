"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Search,
  Filter,
  FileText,
  UserCheck,
  ArrowUpRight,
  TrendingUp,
  Percent,
  Check,
  ChevronDown,
  Info,
  Scale,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/utils";

interface TrustMetric {
  metric: string;
  value: number;
  unit: string;
  sampleSize: number;
  observationWindow: { days: number; from: string; to: string };
  explanation: string;
  eligibilityCriteria: string;
  modelVersion: string;
}

interface SellerTrustData {
  businessId: string;
  businessName: string;
  modelVersion: string;
  calculatedAt: string;
  metrics: {
    fulfillmentRate: TrustMetric;
    completionRate: TrustMetric;
    cancellationRate: TrustMetric;
    refundRate: TrustMetric;
    disputeRate: TrustMetric;
    deliverySuccessRate: TrustMetric;
    averageFulfillmentHours: TrustMetric;
  };
  summary: {
    isEstablishedSeller: boolean;
    totalOrdersInWindow: number;
    disputeRatePercentage: number;
    fulfillmentRatePercentage: number;
  };
  recentSignals: Array<{
    id: string;
    signalType: string;
    category: string;
    direction: string;
    severity: string;
    explanation: string;
    observedAt: string;
  }>;
}

interface RiskReviewItem {
  id: string;
  status: string;
  reason?: string;
  createdAt: string;
  assignedToUser?: { id: string; name: string; email?: string } | null;
  assessment: {
    id: string;
    score: number;
    riskLevel: string;
    reasons: Array<{
      code: string;
      severity: string;
      explanation: string;
      source: string;
    }>;
    socialTransaction: {
      id: string;
      platform: string;
      publicTrackingToken: string;
      order?: {
        orderNumber: string;
        totalAmount: number;
        currency: string;
      } | null;
    };
  };
}

interface DisputeItem {
  id: string;
  status: string;
  category: string;
  reason: string;
  claimantType: string;
  refundAmount?: number | null;
  decisionRecommendation?: string | null;
  createdAt: string;
  transaction: {
    id: string;
    platform: string;
    publicTrackingToken: string;
    order?: {
      orderNumber: string;
      totalAmount: number;
      currency: string;
    } | null;
  };
  evidenceRecords: Array<{
    id: string;
    evidenceType: string;
    actor: string;
    createdAt: string;
  }>;
}

export default function TrustDashboardPage() {
  const [trustData, setTrustData] = useState<SellerTrustData | null>(null);
  const [riskReviews, setRiskReviews] = useState<RiskReviewItem[]>([]);
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"metrics" | "disputes" | "reviews">("metrics");

  // Dispute resolution state
  const [resolvingDisputeId, setResolvingDisputeId] = useState<string | null>(null);
  const [resolutionAction, setResolutionAction] = useState<"APPROVED" | "REJECTED" | "RESOLVED">("RESOLVED");
  const [resolutionReason, setResolutionReason] = useState("");
  const [isSubmittingResolution, setIsSubmittingResolution] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [trustRes, riskRes, disputeRes] = await Promise.all([
        fetch("/api/seller/trust"),
        fetch("/api/seller/risk"),
        fetch("/api/disputes"),
      ]);

      if (!trustRes.ok) throw new Error("Failed to load seller trust profile");
      const trustJson = await trustRes.json();
      setTrustData(trustJson.data);

      if (riskRes.ok) {
        const riskJson = await riskRes.json();
        setRiskReviews(riskJson.data.reviews || []);
      }

      if (disputeRes.ok) {
        const disputeJson = await disputeRes.json();
        setDisputes(disputeJson.data || []);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load trust intelligence");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleResolveDispute = async (disputeId: string) => {
    if (!resolutionReason.trim()) {
      alert("Please enter a resolution explanation");
      return;
    }

    setIsSubmittingResolution(true);
    try {
      const res = await fetch(`/api/disputes/${disputeId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution: resolutionAction,
          resolutionReason,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to resolve dispute");
      }

      setResolvingDisputeId(null);
      setResolutionReason("");
      fetchData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmittingResolution(false);
    }
  };

  const handleResolveRiskReview = async (reviewId: string, decision: "APPROVED" | "DISMISSED") => {
    const notes = prompt(`Enter notes for marking this review ${decision} (minimum 3 characters):`);
    if (!notes) return;
    if (notes.trim().length < 3) {
      alert("Please enter at least 3 characters of explanation notes.");
      return;
    }

    try {
      const res = await fetch(`/api/seller/risk/reviews/${reviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to resolve review");
      }

      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  if (error || !trustData) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-surface-200">
        <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-surface-900">Failed to Load Trust Intelligence</h3>
        <p className="text-sm text-surface-500 mt-1">{error}</p>
        <Button onClick={fetchData} variant="outline" className="mt-4 gap-2">
          <RefreshCw className="h-4 w-4" /> Try Again
        </Button>
      </div>
    );
  }

  const { metrics, summary } = trustData;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-surface-900">Trust & Risk Intelligence</h1>
            <Badge variant="outline" className="text-xs">Model {trustData.modelVersion}</Badge>
            {summary.isEstablishedSeller && (
              <Badge variant="success" className="text-xs gap-1">
                <CheckCircle2 className="h-3 w-3" /> Established Merchant
              </Badge>
            )}
          </div>
          <p className="text-sm text-surface-500 mt-0.5">
            Explainable, deterministic trust metrics and dispute resolution for {trustData.businessName}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={fetchData} variant="outline" size="sm" className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {/* Primary Trust Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-surface-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-surface-500">Fulfillment Rate</span>
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {metrics.fulfillmentRate.value}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-surface-500">
              {metrics.fulfillmentRate.sampleSize} orders evaluated over {metrics.fulfillmentRate.observationWindow.days} days
            </p>
          </CardContent>
        </Card>

        <Card className="border-surface-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-surface-500">Dispute Rate</span>
              <Scale className="h-4 w-4 text-brand-600" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {metrics.disputeRate.value}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-surface-500">
              {metrics.disputeRate.sampleSize} total transactions in observation window
            </p>
          </CardContent>
        </Card>

        <Card className="border-surface-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-surface-500">Cancellation Rate</span>
              <XCircle className="h-4 w-4 text-amber-600" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {metrics.cancellationRate.value}%
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-surface-500">
              {metrics.cancellationRate.sampleSize} total orders tracked
            </p>
          </CardContent>
        </Card>

        <Card className="border-surface-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-surface-500">Avg Fulfillment Time</span>
              <Clock className="h-4 w-4 text-indigo-600" />
            </div>
            <CardTitle className="text-2xl font-bold">
              {metrics.averageFulfillmentHours.value}h
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-surface-500">
              From order confirmation to dispatch
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-surface-200">
        <nav className="flex space-x-6">
          <button
            onClick={() => setActiveTab("metrics")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "metrics"
                ? "border-brand-600 text-brand-600 font-semibold"
                : "border-transparent text-surface-500 hover:text-surface-700"
            }`}
          >
            Mathematical Provenance
          </button>
          <button
            onClick={() => setActiveTab("disputes")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "disputes"
                ? "border-brand-600 text-brand-600 font-semibold"
                : "border-transparent text-surface-500 hover:text-surface-700"
            }`}
          >
            Dispute Cases
            {disputes.length > 0 && (
              <span className="rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2">
                {disputes.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("reviews")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "reviews"
                ? "border-brand-600 text-brand-600 font-semibold"
                : "border-transparent text-surface-500 hover:text-surface-700"
            }`}
          >
            Flagged Transactions & Reviews
            {riskReviews.length > 0 && (
              <span className="rounded-full bg-red-100 text-red-800 text-[10px] font-bold px-1.5 py-0.2">
                {riskReviews.length}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* Tab 1: Mathematical Provenance */}
      {activeTab === "metrics" && (
        <div className="space-y-4">
          <Card className="border-surface-200">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Formulas & Eligibility Criteria</CardTitle>
              <CardDescription className="text-xs">
                All OrderFlow metrics are observable, formulaic, and evidence-backed. No black-box AI scores.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 divide-y divide-surface-100 text-xs">
              {Object.entries(metrics).map(([key, metric]) => (
                <div key={key} className="pt-3 first:pt-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-surface-900">{metric.metric}</span>
                    <span className="font-mono font-bold text-surface-900">
                      {metric.value} {metric.unit}
                    </span>
                  </div>
                  <p className="text-surface-600 mt-1">{metric.explanation}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-surface-400 text-[11px]">
                    <span>Sample Size: {metric.sampleSize}</span>
                    <span>Window: {metric.observationWindow.days} days</span>
                    <span>Eligibility: {metric.eligibilityCriteria}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 2: Dispute Cases */}
      {activeTab === "disputes" && (
        <div className="space-y-4">
          {disputes.length === 0 ? (
            <Card className="border-surface-200 p-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <h4 className="font-semibold text-surface-900 text-sm">No Active Disputes</h4>
              <p className="text-xs text-surface-500 mt-1">
                Your store currently has zero disputes. Excellent customer fulfillment!
              </p>
            </Card>
          ) : (
            disputes.map((d) => (
              <Card key={d.id} className="border-surface-200">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{d.category}</Badge>
                        <Badge
                          variant={
                            d.status === "RESOLVED" || d.status === "APPROVED"
                              ? "success"
                              : d.status === "UNDER_REVIEW"
                              ? "warning"
                              : "default"
                          }
                        >
                          {d.status}
                        </Badge>
                        {d.decisionRecommendation && (
                          <Badge variant="secondary" className="text-[10px]">
                            Recommendation: {d.decisionRecommendation.replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                      <h4 className="font-semibold text-surface-900 text-sm mt-1">
                        Reason: {d.reason}
                      </h4>
                    </div>

                    <div className="text-right text-xs">
                      <div className="font-mono text-surface-900">
                        Tx: {d.transaction.publicTrackingToken.slice(0, 12)}...
                      </div>
                      <div className="text-surface-400">
                        {formatDate(d.createdAt)}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-3 text-xs">
                  <div className="flex items-center justify-between border-t border-surface-100 pt-3">
                    <span className="text-surface-500">
                      Evidence records attached: {d.evidenceRecords.length}
                    </span>

                    {resolvingDisputeId === d.id ? (
                      <div className="space-y-2 w-full max-w-md ml-auto">
                        <select
                          value={resolutionAction}
                          onChange={(e: any) => setResolutionAction(e.target.value)}
                          className="w-full rounded-md border border-surface-300 p-1.5 text-xs"
                        >
                          <option value="RESOLVED">Resolve (Mutual Agreement)</option>
                          <option value="APPROVED">Approve Dispute & Refund</option>
                          <option value="REJECTED">Reject Dispute</option>
                        </select>
                        <input
                          type="text"
                          placeholder="Resolution reason / explanation"
                          value={resolutionReason}
                          onChange={(e) => setResolutionReason(e.target.value)}
                          className="w-full rounded-md border border-surface-300 p-1.5 text-xs"
                        />
                        <div className="flex items-center gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setResolvingDisputeId(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleResolveDispute(d.id)}
                            isLoading={isSubmittingResolution}
                          >
                            Confirm Resolution
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Link href={`/t/${encodeURIComponent(d.transaction.publicTrackingToken)}`}>
                          <Button size="sm" variant="outline" className="text-xs h-7">
                            View Transaction Room
                          </Button>
                        </Link>
                        {d.status !== "RESOLVED" && d.status !== "CLOSED" && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setResolvingDisputeId(d.id);
                              setResolutionReason("");
                            }}
                            className="text-xs h-7"
                          >
                            Resolve Dispute
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Tab 3: Flagged Transactions & Reviews */}
      {activeTab === "reviews" && (
        <div className="space-y-4">
          {riskReviews.length === 0 ? (
            <Card className="border-surface-200 p-8 text-center">
              <ShieldCheck className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <h4 className="font-semibold text-surface-900 text-sm">No Pending Risk Reviews</h4>
              <p className="text-xs text-surface-500 mt-1">
                All recent transactions have passed deterministic risk thresholds.
              </p>
            </Card>
          ) : (
            riskReviews.map((r) => (
              <Card key={r.id} className="border-surface-200">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">Risk Level: {r.assessment.riskLevel}</Badge>
                      <Badge variant="outline">Score: {r.assessment.score}/100</Badge>
                      <Badge variant="secondary">{r.status}</Badge>
                    </div>
                    <span className="text-xs text-surface-400">
                      {formatDate(r.createdAt)}
                    </span>
                  </div>
                  <CardTitle className="text-sm font-semibold mt-2">
                    Order #{r.assessment.socialTransaction?.order?.orderNumber || "Draft"} (
                    {r.assessment.socialTransaction?.platform || "UNKNOWN"})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div>
                    <h5 className="font-semibold text-surface-700 mb-1">Observable Risk Signals:</h5>
                    <ul className="space-y-1">
                      {(r.assessment.reasons || []).map((reason, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 text-surface-600">
                          <span className="font-semibold font-mono text-[11px] text-surface-800">
                            [{reason.code}]:
                          </span>
                          <span>{reason.explanation}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {(r.status === "OPEN" || r.status === "IN_PROGRESS") && (
                    <div className="flex items-center justify-end gap-2 border-t border-surface-100 pt-3">
                      {r.assessment.socialTransaction?.publicTrackingToken && (
                        <Link href={`/t/${encodeURIComponent(r.assessment.socialTransaction.publicTrackingToken)}`}>
                          <Button size="sm" variant="ghost" className="text-xs h-7">
                            View Transaction
                          </Button>
                        </Link>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResolveRiskReview(r.id, "DISMISSED")}
                        className="text-xs h-7"
                      >
                        Dismiss False Alarm
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleResolveRiskReview(r.id, "APPROVED")}
                        className="text-xs h-7"
                      >
                        Approve Exception
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
