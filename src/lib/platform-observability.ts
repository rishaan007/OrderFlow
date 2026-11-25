import {
  OrderStatus,
  PaymentIntentStatus,
  ReconciliationStatus,
  ShipmentStatus,
  TransactionStatus,
  WebhookDeliveryStatus,
} from "@prisma/client";
import { prisma } from "./prisma";
import { toMinorUnits } from "./money";

export interface PlatformMetricWithProvenance {
  name: string;
  value: number;
  unit: string;
  definition: string;
  timeWindowDays: number;
  sampleSize: number;
  provenance: string;
}

/**
 * Computes tenant-safe or platform-level commerce outcome metrics with strict provenance.
 * Excludes sandbox records (`isSandbox: false`) so test activity never skews live metrics.
 */
export async function getPlatformObservabilitySnapshot(options?: {
  windowDays?: number;
  businessId?: string;
}) {
  const windowDays = Math.min(365, Math.max(1, options?.windowDays ?? 30));
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const businessFilter = options?.businessId ? { businessId: options.businessId } : {};

  const [
    orders,
    paymentIntents,
    refundsCount,
    shipments,
    reconTotal,
    reconMismatches,
    disputesCount,
    returnsCount,
    apiReqCount,
    webhookDelivered,
    webhookTotal,
    activeBuyersCount,
    activeSellersCount,
    listingsAgg,
  ] = await Promise.all([
    prisma.order.findMany({
      where: {
        ...businessFilter,
        isSandbox: false,
        createdAt: { gte: since },
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        currency: true,
        customerId: true,
      },
    }),
    prisma.paymentIntent.findMany({
      where: {
        ...businessFilter,
        isSandbox: false,
        createdAt: { gte: since },
      },
      select: { status: true },
    }),
    prisma.refund.count({
      where: {
        ...businessFilter,
        isSandbox: false,
        createdAt: { gte: since },
      },
    }),
    prisma.shipment.findMany({
      where: {
        ...businessFilter,
        isSandbox: false,
        createdAt: { gte: since },
      },
      select: { status: true },
    }),
    prisma.reconciliationEntry.count({
      where: { ...businessFilter, createdAt: { gte: since } },
    }),
    prisma.reconciliationEntry.count({
      where: {
        ...businessFilter,
        status: { not: ReconciliationStatus.MATCHED },
        createdAt: { gte: since },
      },
    }),
    prisma.transactionDispute.count({
      where: { ...businessFilter, createdAt: { gte: since } },
    }),
    prisma.returnRequest.count({
      where: { ...businessFilter, createdAt: { gte: since } },
    }),
    prisma.apiUsage.count({
      where: {
        ...businessFilter,
        environment: "LIVE",
        createdAt: { gte: since },
      },
    }),
    prisma.webhookDelivery.count({
      where: {
        ...businessFilter,
        status: WebhookDeliveryStatus.DELIVERED,
        createdAt: { gte: since },
      },
    }),
    prisma.webhookDelivery.count({
      where: { ...businessFilter, createdAt: { gte: since } },
    }),
    prisma.buyerIdentity.count({
      where: { status: "ACTIVE" },
    }),
    prisma.business.count({
      where: { accountStatus: "ACTIVE", isSandboxBusiness: false },
    }),
    prisma.marketplaceListing.aggregate({
      where: { ...businessFilter, discoverable: true },
      _sum: { viewsCount: true, ordersCount: true },
      _count: { id: true },
    }),
  ]);

  const activeOrders = orders.filter((o) => o.status !== OrderStatus.CANCELLED);
  const completedOrders = orders.filter((o) => o.status === OrderStatus.DELIVERED);
  const gmvMajor = activeOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

  const capturedIntents = paymentIntents.filter(
    (pi) =>
      pi.status === PaymentIntentStatus.CAPTURED ||
      pi.status === PaymentIntentStatus.PARTIALLY_CAPTURED ||
      pi.status === PaymentIntentStatus.PARTIALLY_REFUNDED ||
      pi.status === PaymentIntentStatus.REFUNDED
  ).length;

  const paymentSuccessRate =
    paymentIntents.length > 0
      ? Math.round((capturedIntents / paymentIntents.length) * 1000) / 10
      : 100;

  const deliveredShipments = shipments.filter((s) => s.status === ShipmentStatus.DELIVERED).length;
  const exceptionShipments = shipments.filter((s) =>
    ["FAILED_ATTEMPT", "RETURNED_TO_ORIGIN", "LOST", "DAMAGED"].includes(s.status)
  ).length;
  const deliverySuccessRate =
    shipments.length > 0
      ? Math.round((deliveredShipments / shipments.length) * 1000) / 10
      : 100;

  const reconMismatchRate =
    reconTotal > 0 ? Math.round((reconMismatches / reconTotal) * 1000) / 10 : 0;

  const webhookSuccessRate =
    webhookTotal > 0 ? Math.round((webhookDelivered / webhookTotal) * 1000) / 10 : 100;

  const totalOrdersCount = orders.length;
  const returnRate =
    totalOrdersCount > 0 ? Math.round((returnsCount / totalOrdersCount) * 1000) / 10 : 0;
  const disputeRate =
    totalOrdersCount > 0 ? Math.round((disputesCount / totalOrdersCount) * 1000) / 10 : 0;
  const refundRate =
    totalOrdersCount > 0 ? Math.round((refundsCount / totalOrdersCount) * 1000) / 10 : 0;

  const buildMetric = (
    name: string,
    value: number,
    unit: string,
    definition: string,
    sampleSize: number,
    provenance: string
  ): PlatformMetricWithProvenance => ({
    name,
    value,
    unit,
    definition,
    timeWindowDays: windowDays,
    sampleSize,
    provenance,
  });

  return {
    scope: options?.businessId ? `TENANT:${options.businessId}` : "PLATFORM_NETWORK",
    generatedAtUtc: new Date().toISOString(),
    network: {
      gmv: buildMetric(
        "Gross Merchandise Value",
        Math.round(gmvMajor * 100) / 100,
        "currency_major",
        "Sum of non-cancelled live order total amounts in window.",
        activeOrders.length,
        "orders (isSandbox=false, status != CANCELLED)"
      ),
      completedTransactions: buildMetric(
        "Completed Transactions",
        completedOrders.length,
        "count",
        "Live orders reaching DELIVERED status.",
        totalOrdersCount,
        "orders (status = DELIVERED)"
      ),
      activeBuyers: activeBuyersCount,
      activeSellers: activeSellersCount,
    },
    payments: {
      paymentSuccessRate: buildMetric(
        "Payment Success Rate",
        paymentSuccessRate,
        "percent",
        "Percentage of live payment intents reaching captured state.",
        paymentIntents.length,
        "payment_intents (isSandbox=false)"
      ),
      refundRate: buildMetric(
        "Refund Rate",
        refundRate,
        "percent",
        "Ratio of live refunds initiated to total live orders.",
        totalOrdersCount,
        "refunds / orders"
      ),
      reconciliationMismatchRate: buildMetric(
        "Reconciliation Mismatch Rate",
        reconMismatchRate,
        "percent",
        "Share of reconciliation entries flagged non-matched.",
        reconTotal,
        "reconciliation_entries"
      ),
    },
    logistics: {
      deliverySuccessRate: buildMetric(
        "Delivery Success Rate",
        deliverySuccessRate,
        "percent",
        "Percentage of live shipments marked DELIVERED.",
        shipments.length,
        "shipments (isSandbox=false)"
      ),
      deliveryExceptions: exceptionShipments,
      returnRate: buildMetric(
        "Return Rate",
        returnRate,
        "percent",
        "Ratio of return requests to total live orders.",
        totalOrdersCount,
        "return_requests / orders"
      ),
      disputeRate: buildMetric(
        "Dispute Rate",
        disputeRate,
        "percent",
        "Ratio of dispute cases to total live orders.",
        totalOrdersCount,
        "transaction_disputes / orders"
      ),
    },
    marketplace: {
      discoverableListings: listingsAgg._count.id,
      listingViews: listingsAgg._sum.viewsCount ?? 0,
      listingOrders: listingsAgg._sum.ordersCount ?? 0,
    },
    developerPlatform: {
      liveApiRequests: apiReqCount,
      webhookSuccessRate: buildMetric(
        "Webhook Delivery Success Rate",
        webhookSuccessRate,
        "percent",
        "Delivered outbound webhooks over total webhook attempts.",
        webhookTotal,
        "webhook_deliveries"
      ),
    },
  };
}
