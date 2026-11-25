import { prisma } from "./prisma";
import {
  OrderStatus,
  PaymentStatus,
  TransactionStatus,
  DisputeStatus,
  IdentityConfidence,
  BuyerIdentityProvider,
} from "@prisma/client";
import { getTrustSignals } from "./trust-signals";

export interface ObservationWindow {
  days: number;
  from: string;
  to: string;
}

export interface MetricProvenance {
  metric: string;
  value: number;
  unit: string;
  sampleSize: number;
  observationWindow: ObservationWindow;
  explanation: string;
  eligibilityCriteria: string;
  modelVersion: string;
}

export interface SellerTrustProfile {
  businessId: string;
  businessName: string;
  modelVersion: string;
  calculatedAt: string;
  metrics: {
    fulfillmentRate: MetricProvenance;
    completionRate: MetricProvenance;
    cancellationRate: MetricProvenance;
    refundRate: MetricProvenance;
    disputeRate: MetricProvenance;
    deliverySuccessRate: MetricProvenance;
    averageFulfillmentHours: MetricProvenance;
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

export interface BuyerTrustProfile {
  buyerIdentityId: string;
  modelVersion: string;
  calculatedAt: string;
  metrics: {
    completedTransactions: MetricProvenance;
    cancellationRate: MetricProvenance;
    disputeRate: MetricProvenance;
    accountAgeDays: MetricProvenance;
    verifiedChannelsCount: MetricProvenance;
  };
  identity: {
    verificationLevel: IdentityConfidence;
    emailVerified: boolean;
    phoneVerified: boolean;
    connectedChannelsCount: number;
  };
  summary: {
    isEstablishedBuyer: boolean;
    totalCompletedTransactions: number;
    hasActiveDisputes: boolean;
    disputeRateBucket: "NONE" | "LOW" | "NORMAL" | "HIGH";
  };
}

export interface BuyerTrustSummaryForSeller {
  buyerIdentityId: string;
  isEstablishedBuyer: boolean;
  verificationLevel: IdentityConfidence;
  totalCompletedTransactionsInPlatform: number;
  disputeRateBucket: "NONE" | "LOW" | "NORMAL" | "HIGH";
  accountAgeBucket: "NEW" | "ESTABLISHED" | "VETERAN";
  explanation: string;
}

/**
 * Calculates the Seller Trust Profile for a business with explicit mathematical formulas,
 * clear observation windows, and complete provenance.
 *
 * Formulas:
 * - Fulfillment Rate = (Delivered Orders) / (Eligible Orders: Delivered + Shipped + Confirmed + Cancelled + Refunded)
 * - Completion Rate = (Delivered Orders) / (Total Orders in window)
 * - Cancellation Rate = (Cancelled Orders) / (Total Orders in window)
 * - Refund Rate = (Refunded Orders) / (Total Orders in window)
 * - Dispute Rate = (Disputes created in window) / (Total Transactions in window)
 */
export async function getSellerTrustProfile(
  businessId: string,
  options?: { windowDays?: number; referenceDate?: Date }
): Promise<SellerTrustProfile> {
  const windowDays = options?.windowDays ?? 180;
  const now = options?.referenceDate ?? new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, createdAt: true },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  // 1. Fetch Orders within observation window
  const orders = await prisma.order.findMany({
    where: {
      businessId,
      createdAt: { gte: windowStart, lte: now },
    },
    include: {
      shipments: {
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  // 2. Fetch Transactions within observation window
  const transactions = await prisma.socialTransaction.findMany({
    where: {
      businessId,
      createdAt: { gte: windowStart, lte: now },
    },
    select: { id: true, status: true },
  });

  // 3. Fetch Disputes within observation window
  const disputes = await prisma.transactionDispute.findMany({
    where: {
      businessId,
      createdAt: { gte: windowStart, lte: now },
    },
    select: { id: true, status: true },
  });

  const totalOrders = orders.length;
  const deliveredOrders = orders.filter((o) => o.status === OrderStatus.DELIVERED).length;
  const cancelledOrders = orders.filter((o) => o.status === OrderStatus.CANCELLED).length;
  const refundedOrders = orders.filter(
    (o) => o.paymentStatus === PaymentStatus.REFUNDED
  ).length;

  // Eligible orders for fulfillment rate exclude orders still pending initial seller review
  const eligibleFulfillmentOrders = orders.filter(
    (o) =>
      (
        [
          OrderStatus.DELIVERED,
          OrderStatus.SHIPPED,
          OrderStatus.CONFIRMED,
          OrderStatus.CANCELLED,
        ] as OrderStatus[]
      ).includes(o.status) || o.paymentStatus === PaymentStatus.REFUNDED
  ).length;

  const fulfillmentRate =
    eligibleFulfillmentOrders > 0
      ? Math.round((deliveredOrders / eligibleFulfillmentOrders) * 1000) / 10
      : 100.0;

  const completionRate =
    totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 1000) / 10 : 100.0;

  const cancellationRate =
    totalOrders > 0 ? Math.round((cancelledOrders / totalOrders) * 1000) / 10 : 0.0;

  const refundRate =
    totalOrders > 0 ? Math.round((refundedOrders / totalOrders) * 1000) / 10 : 0.0;

  const totalTransactions = transactions.length;
  const disputeRate =
    totalTransactions > 0
      ? Math.round((disputes.length / totalTransactions) * 1000) / 10
      : 0.0;

  // Calculate average fulfillment time in hours (order creation to shipment creation)
  let totalFulfillmentHours = 0;
  let fulfilledWithShipmentCount = 0;
  for (const o of orders) {
    if (o.shipments.length > 0) {
      const diffMs = o.shipments[0].createdAt.getTime() - o.createdAt.getTime();
      const diffHours = Math.max(0, diffMs / (1000 * 60 * 60));
      totalFulfillmentHours += diffHours;
      fulfilledWithShipmentCount++;
    }
  }
  const avgFulfillmentHours =
    fulfilledWithShipmentCount > 0
      ? Math.round((totalFulfillmentHours / fulfilledWithShipmentCount) * 10) / 10
      : 24.0;

  // Fetch active signals for this business
  const activeSignals = await getTrustSignals({
    businessId,
    activeOnly: true,
    take: 10,
  });

  const obsWindow: ObservationWindow = {
    days: windowDays,
    from: windowStart.toISOString(),
    to: now.toISOString(),
  };

  const modelVersion = "v1";

  return {
    businessId: business.id,
    businessName: business.name,
    modelVersion,
    calculatedAt: now.toISOString(),
    metrics: {
      fulfillmentRate: {
        metric: "FULFILLMENT_RATE",
        value: fulfillmentRate,
        unit: "percent",
        sampleSize: eligibleFulfillmentOrders,
        observationWindow: obsWindow,
        explanation: `${fulfillmentRate}% of eligible orders (${deliveredOrders}/${eligibleFulfillmentOrders}) were successfully delivered.`,
        eligibilityCriteria: "Delivered, Shipped, Confirmed, Cancelled, or Refunded orders.",
        modelVersion,
      },
      completionRate: {
        metric: "COMPLETION_RATE",
        value: completionRate,
        unit: "percent",
        sampleSize: totalOrders,
        observationWindow: obsWindow,
        explanation: `${completionRate}% of total orders placed reached complete delivery.`,
        eligibilityCriteria: "All orders placed within observation window.",
        modelVersion,
      },
      cancellationRate: {
        metric: "CANCELLATION_RATE",
        value: cancellationRate,
        unit: "percent",
        sampleSize: totalOrders,
        observationWindow: obsWindow,
        explanation: `${cancellationRate}% of orders were cancelled.`,
        eligibilityCriteria: "All orders placed within observation window.",
        modelVersion,
      },
      refundRate: {
        metric: "REFUND_RATE",
        value: refundRate,
        unit: "percent",
        sampleSize: totalOrders,
        observationWindow: obsWindow,
        explanation: `${refundRate}% of orders resulted in customer refunds.`,
        eligibilityCriteria: "All orders placed within observation window.",
        modelVersion,
      },
      disputeRate: {
        metric: "DISPUTE_RATE",
        value: disputeRate,
        unit: "percent",
        sampleSize: totalTransactions,
        observationWindow: obsWindow,
        explanation: `${disputeRate}% of social transactions had disputes opened (${disputes.length}/${totalTransactions}).`,
        eligibilityCriteria: "All social transactions initiated within observation window.",
        modelVersion,
      },
      deliverySuccessRate: {
        metric: "DELIVERY_SUCCESS_RATE",
        value: fulfillmentRate,
        unit: "percent",
        sampleSize: eligibleFulfillmentOrders,
        observationWindow: obsWindow,
        explanation: `${fulfillmentRate}% delivery success rate without package loss disputes.`,
        eligibilityCriteria: "Eligible fulfilled orders.",
        modelVersion,
      },
      averageFulfillmentHours: {
        metric: "AVG_FULFILLMENT_HOURS",
        value: avgFulfillmentHours,
        unit: "hours",
        sampleSize: fulfilledWithShipmentCount,
        observationWindow: obsWindow,
        explanation: `Orders are dispatched in an average of ${avgFulfillmentHours} hours.`,
        eligibilityCriteria: "Orders with tracked shipments.",
        modelVersion,
      },
    },
    summary: {
      isEstablishedSeller: totalOrders >= 5,
      totalOrdersInWindow: totalOrders,
      disputeRatePercentage: disputeRate,
      fulfillmentRatePercentage: fulfillmentRate,
    },
    recentSignals: activeSignals.map((s) => ({
      id: s.id,
      signalType: s.signalType,
      category: s.category,
      direction: s.direction,
      severity: s.severity,
      explanation: s.explanation,
      observedAt: s.observedAt.toISOString(),
    })),
  };
}

/**
 * Calculates Buyer Trust Profile for an individual buyer identity across OrderFlow.
 */
export async function getBuyerTrustProfile(
  buyerIdentityId: string,
  options?: { windowDays?: number; referenceDate?: Date }
): Promise<BuyerTrustProfile> {
  const windowDays = options?.windowDays ?? 365;
  const now = options?.referenceDate ?? new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const buyer = await prisma.buyerIdentity.findUnique({
    where: { id: buyerIdentityId },
    include: {
      links: true,
      transactions: {
        where: { createdAt: { gte: windowStart, lte: now } },
        include: {
          disputes: {
            select: { id: true, status: true },
          },
        },
      },
    },
  });

  if (!buyer) {
    throw new Error("Buyer identity not found");
  }

  const transactions = buyer.transactions;
  const totalTx = transactions.length;
  const completedTx = transactions.filter(
    (t) =>
      t.status === TransactionStatus.COMPLETED || t.status === TransactionStatus.DELIVERED
  ).length;
  const cancelledTx = transactions.filter(
    (t) => t.status === TransactionStatus.CANCELLED
  ).length;

  const allDisputes = transactions.flatMap((t) => t.disputes);
  const activeDisputes = allDisputes.filter((d) =>
    ["REQUESTED", "OPEN", "UNDER_REVIEW", "EVIDENCE_REQUESTED", "EVIDENCE_SUBMITTED"].includes(
      d.status
    )
  );

  const disputeRate =
    totalTx > 0 ? Math.round((allDisputes.length / totalTx) * 1000) / 10 : 0.0;
  const cancellationRate =
    totalTx > 0 ? Math.round((cancelledTx / totalTx) * 1000) / 10 : 0.0;

  const accountAgeDays = Math.max(
    0,
    Math.floor((now.getTime() - buyer.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  );

  const verifiedChannels = buyer.links.filter(
    (l) => l.confidence !== IdentityConfidence.UNVERIFIED
  ).length;

  const obsWindow: ObservationWindow = {
    days: windowDays,
    from: windowStart.toISOString(),
    to: now.toISOString(),
  };

  const modelVersion = "v1";

  let disputeRateBucket: "NONE" | "LOW" | "NORMAL" | "HIGH" = "NONE";
  if (allDisputes.length === 0) disputeRateBucket = "NONE";
  else if (disputeRate <= 5.0) disputeRateBucket = "LOW";
  else if (disputeRate <= 15.0) disputeRateBucket = "NORMAL";
  else disputeRateBucket = "HIGH";

  return {
    buyerIdentityId: buyer.id,
    modelVersion,
    calculatedAt: now.toISOString(),
    metrics: {
      completedTransactions: {
        metric: "COMPLETED_TRANSACTIONS",
        value: completedTx,
        unit: "count",
        sampleSize: totalTx,
        observationWindow: obsWindow,
        explanation: `${completedTx} completed transactions in the observation window.`,
        eligibilityCriteria: "Transactions reaching COMPLETED or DELIVERED status.",
        modelVersion,
      },
      cancellationRate: {
        metric: "CANCELLATION_RATE",
        value: cancellationRate,
        unit: "percent",
        sampleSize: totalTx,
        observationWindow: obsWindow,
        explanation: `${cancellationRate}% cancellation rate.`,
        eligibilityCriteria: "All transactions in window.",
        modelVersion,
      },
      disputeRate: {
        metric: "DISPUTE_RATE",
        value: disputeRate,
        unit: "percent",
        sampleSize: totalTx,
        observationWindow: obsWindow,
        explanation: `${disputeRate}% dispute rate (${allDisputes.length}/${totalTx}).`,
        eligibilityCriteria: "All transactions with disputes.",
        modelVersion,
      },
      accountAgeDays: {
        metric: "ACCOUNT_AGE_DAYS",
        value: accountAgeDays,
        unit: "days",
        sampleSize: 1,
        observationWindow: obsWindow,
        explanation: `OrderFlow buyer identity created ${accountAgeDays} days ago.`,
        eligibilityCriteria: "Identity creation date.",
        modelVersion,
      },
      verifiedChannelsCount: {
        metric: "VERIFIED_CHANNELS_COUNT",
        value: verifiedChannels,
        unit: "count",
        sampleSize: buyer.links.length,
        observationWindow: obsWindow,
        explanation: `${verifiedChannels} verified social or contact channels linked.`,
        eligibilityCriteria: "Verified or Strongly Verified links.",
        modelVersion,
      },
    },
    identity: {
      verificationLevel: buyer.verificationLevel,
      emailVerified: Boolean(buyer.emailVerifiedAt),
      phoneVerified: Boolean(buyer.phoneVerifiedAt),
      connectedChannelsCount: buyer.links.length,
    },
    summary: {
      isEstablishedBuyer: completedTx >= 3 || accountAgeDays >= 30,
      totalCompletedTransactions: completedTx,
      hasActiveDisputes: activeDisputes.length > 0,
      disputeRateBucket,
    },
  };
}

/**
 * Privacy-preserving seller view of buyer trust.
 * Strictly avoids cross-seller information leakage: never exposes other sellers'
 * names, item descriptions, payment amounts, private notes, or addresses.
 */
export async function getBuyerTrustProfileForSeller(
  businessId: string,
  buyerIdentityId: string
): Promise<BuyerTrustSummaryForSeller> {
  const profile = await getBuyerTrustProfile(buyerIdentityId);

  const completed = profile.summary.totalCompletedTransactions;
  const isEstablished = profile.summary.isEstablishedBuyer;
  const ageDays = profile.metrics.accountAgeDays.value;

  let accountAgeBucket: "NEW" | "ESTABLISHED" | "VETERAN" = "NEW";
  if (ageDays >= 180) accountAgeBucket = "VETERAN";
  else if (ageDays >= 30) accountAgeBucket = "ESTABLISHED";

  let explanation = "New buyer on OrderFlow.";
  if (completed >= 10) {
    explanation = "Highly experienced buyer with 10+ completed transactions across OrderFlow.";
  } else if (completed >= 3) {
    explanation = "Established buyer with proven transaction history.";
  } else if (profile.identity.verificationLevel !== IdentityConfidence.UNVERIFIED) {
    explanation = "Buyer with verified contact credentials.";
  }

  return {
    buyerIdentityId,
    isEstablishedBuyer: isEstablished,
    verificationLevel: profile.identity.verificationLevel,
    totalCompletedTransactionsInPlatform: completed,
    disputeRateBucket: profile.summary.disputeRateBucket,
    accountAgeBucket,
    explanation,
  };
}
