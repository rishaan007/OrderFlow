import crypto from "crypto";
import {
  BuyerIdentityEventType,
  BuyerIdentityStatus,
  EvidenceVerificationState,
  Prisma,
  TimelineVisibility,
} from "@prisma/client";
import { prisma } from "./prisma";
import { getOrCreateBuyerIdentity, recordIdentityEvent } from "./buyer-identity";
import { generateCsv } from "./csv-export";
import { logAuditEvent } from "./team";
import { ValidationError } from "./errors";

/**
 * Exports all data the buyer is legitimately entitled to carry across the network.
 * Strictly NEVER exports internal seller notes, margins, other buyers' info, or risk scores.
 */
export async function exportBuyerPortabilityData(
  userId: string,
  format: "JSON" | "CSV" = "JSON"
) {
  const identity = await getOrCreateBuyerIdentity(userId);

  const [links, transactions, reviews, returns] = await Promise.all([
    prisma.buyerIdentityLink.findMany({
      where: { buyerIdentityId: identity.id },
      select: {
        id: true,
        provider: true,
        externalIdentityId: true,
        confidence: true,
        verifiedAt: true,
        createdAt: true,
      },
    }),
    prisma.socialTransaction.findMany({
      where: {
        OR: [{ buyerUserId: userId }, { buyerIdentityId: identity.id }],
        isSandbox: false,
      },
      include: {
        business: { select: { id: true, name: true, slug: true, currency: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            fulfillmentStatus: true,
            paymentStatus: true,
            source: true,
            currency: true,
            subtotal: true,
            discount: true,
            tax: true,
            shipping: true,
            totalAmount: true,
            amountPaid: true,
            totalSnapshot: true,
            taxBreakdown: true,
            shippingAddress: true,
            createdAt: true,
            items: {
              select: {
                title: true,
                variantTitle: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
              },
            },
            payments: {
              where: { status: "VERIFIED" },
              select: {
                id: true,
                amount: true,
                currency: true,
                method: true,
                referenceNumber: true,
                verifiedAt: true,
              },
            },
            shipments: {
              select: {
                carrier: true,
                trackingNumber: true,
                status: true,
                actualDelivery: true,
              },
            },
          },
        },
        timelineEvents: {
          where: { visibility: TimelineVisibility.PUBLIC },
          orderBy: { createdAt: "asc" },
          select: {
            eventType: true,
            title: true,
            description: true,
            actor: true,
            createdAt: true,
          },
        },
        evidence: {
          where: {
            verificationState: {
              in: [
                EvidenceVerificationState.BUYER_CONFIRMED,
                EvidenceVerificationState.SELLER_CONFIRMED,
                EvidenceVerificationState.OBSERVED,
                EvidenceVerificationState.SYSTEM_GENERATED,
              ],
            },
          },
          select: {
            evidenceType: true,
            verificationState: true,
            source: true,
            mediaUrl: true,
            notes: true,
            contentHash: true,
            capturedAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.review.findMany({
      where: { buyerIdentityId: identity.id },
      select: {
        id: true,
        businessId: true,
        orderId: true,
        productId: true,
        rating: true,
        title: true,
        comment: true,
        authorDisplayMode: true,
        createdAt: true,
      },
    }),
    prisma.returnRequest.findMany({
      where: { buyerIdentityId: identity.id },
      select: {
        id: true,
        orderId: true,
        status: true,
        reason: true,
        requestedAmountMinorUnits: true,
        approvedAmountMinorUnits: true,
        currency: true,
        createdAt: true,
      },
    }),
  ]);

  // Deliberately omits sellerNotes, internal notes, risk scores, costPrice, reconciliation
  const exportPayload = {
    schemaVersion: "orderflow.buyer_export.v1",
    exportedAtUtc: new Date().toISOString(),
    buyerIdentity: {
      id: identity.id,
      displayName: identity.displayName,
      locale: identity.locale,
      timezone: identity.timezone,
      countryCode: identity.countryCode,
      verificationLevel: identity.verificationLevel,
      networkVisibility: identity.networkVisibility,
      reviewDisplayMode: identity.reviewDisplayMode,
      createdAt: identity.createdAt.toISOString(),
    },
    connectedIdentities: links.map((l) => ({
      provider: l.provider,
      identifier: l.externalIdentityId,
      confidence: l.confidence,
      verifiedAt: l.verifiedAt?.toISOString() ?? null,
    })),
    transactions: transactions.map((tx) => ({
      transactionId: tx.id,
      trackingToken: tx.publicTrackingToken,
      platform: tx.platform,
      surface: tx.surface,
      status: tx.status,
      seller: tx.business,
      createdAt: tx.createdAt.toISOString(),
      receipt: tx.order
        ? {
            orderNumber: tx.order.orderNumber,
            status: tx.order.status,
            fulfillmentStatus: tx.order.fulfillmentStatus,
            paymentStatus: tx.order.paymentStatus,
            currency: tx.order.currency,
            subtotal: Number(tx.order.subtotal),
            discount: Number(tx.order.discount),
            tax: Number(tx.order.tax),
            shipping: Number(tx.order.shipping),
            totalAmount: Number(tx.order.totalAmount),
            amountPaid: Number(tx.order.amountPaid),
            totalSnapshot: tx.order.totalSnapshot,
            taxBreakdown: tx.order.taxBreakdown,
            shippingAddress: tx.order.shippingAddress,
            items: tx.order.items.map((i) => ({
              title: i.title,
              variantTitle: i.variantTitle,
              quantity: i.quantity,
              unitPrice: Number(i.unitPrice),
              totalPrice: Number(i.totalPrice),
            })),
            verifiedPayments: tx.order.payments,
            shipments: tx.order.shipments,
          }
        : null,
      publicTimeline: tx.timelineEvents,
      eligibleEvidence: tx.evidence,
    })),
    reviews,
    returns,
  };

  const jsonString = JSON.stringify(exportPayload);
  const checksum = crypto.createHash("sha256").update(jsonString, "utf8").digest("hex");

  const record = await prisma.dataExport.create({
    data: {
      requesterType: "BUYER",
      requesterId: userId,
      buyerIdentityId: identity.id,
      exportType: "BUYER_FULL_PORTABILITY",
      format,
      status: "COMPLETED",
      recordCount: transactions.length,
      checksum,
    },
  });

  await recordIdentityEvent(prisma, identity.id, BuyerIdentityEventType.IDENTITY_EXPORTED, {
    actorType: "BUYER",
    actorUserId: userId,
    metadata: { exportId: record.id, format, transactionCount: transactions.length },
  });

  if (format === "CSV") {
    const headers = [
      "Transaction ID",
      "Platform",
      "Seller",
      "Order Number",
      "Order Status",
      "Payment Status",
      "Currency",
      "Total Amount",
      "Amount Paid",
      "Date",
    ];
    const rows = transactions.map((tx) => [
      tx.id,
      tx.platform,
      tx.business.name,
      tx.order?.orderNumber || "",
      tx.order?.status || tx.status,
      tx.order?.paymentStatus || "",
      tx.order?.currency || tx.business.currency,
      tx.order ? Number(tx.order.totalAmount) : 0,
      tx.order ? Number(tx.order.amountPaid) : 0,
      tx.createdAt.toISOString(),
    ]);
    return {
      exportId: record.id,
      checksum,
      format: "CSV" as const,
      csv: generateCsv(headers, rows),
    };
  }

  return {
    exportId: record.id,
    checksum,
    format: "JSON" as const,
    data: exportPayload,
  };
}

export type SellerExportEntity =
  | "orders"
  | "products"
  | "customers"
  | "transactions"
  | "payments"
  | "refunds"
  | "shipments"
  | "reconciliation"
  | "analytics";

/**
 * Seller-scoped structured data portability export with audit trail & tenant lock.
 */
export async function exportSellerTenantData(
  businessId: string,
  userId: string,
  exportType: SellerExportEntity
) {
  let payload: unknown;
  let recordCount = 0;

  switch (exportType) {
    case "orders": {
      const rows = await prisma.order.findMany({
        where: { businessId, isSandbox: false },
        include: { items: true, customer: { select: { id: true, name: true, email: true, phone: true } } },
        orderBy: { createdAt: "desc" },
      });
      recordCount = rows.length;
      payload = rows;
      break;
    }
    case "products": {
      const rows = await prisma.product.findMany({
        where: { businessId },
        include: { variants: true, channelListings: true },
        orderBy: { createdAt: "desc" },
      });
      recordCount = rows.length;
      payload = rows;
      break;
    }
    case "customers": {
      const rows = await prisma.customer.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
      });
      recordCount = rows.length;
      payload = rows;
      break;
    }
    case "transactions": {
      const rows = await prisma.socialTransaction.findMany({
        where: { businessId, isSandbox: false },
        include: { order: { select: { orderNumber: true, totalAmount: true, status: true } } },
        orderBy: { createdAt: "desc" },
      });
      recordCount = rows.length;
      payload = rows;
      break;
    }
    case "payments": {
      const rows = await prisma.payment.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
      });
      recordCount = rows.length;
      payload = rows;
      break;
    }
    case "refunds": {
      const rows = await prisma.refund.findMany({
        where: { businessId, isSandbox: false },
        orderBy: { createdAt: "desc" },
      });
      recordCount = rows.length;
      payload = rows;
      break;
    }
    case "shipments": {
      const rows = await prisma.shipment.findMany({
        where: { businessId, isSandbox: false },
        include: { trackingEvents: true },
        orderBy: { createdAt: "desc" },
      });
      recordCount = rows.length;
      payload = rows;
      break;
    }
    case "reconciliation": {
      const rows = await prisma.reconciliationRun.findMany({
        where: { businessId },
        include: { entries: true },
        orderBy: { createdAt: "desc" },
      });
      recordCount = rows.length;
      payload = rows;
      break;
    }
    case "analytics": {
      const { getBusinessRevenueAnalytics, getBusinessProductPerformance } = await import("./analytics");
      const [revenue, products] = await Promise.all([
        getBusinessRevenueAnalytics(businessId, { days: 90 }),
        getBusinessProductPerformance(businessId),
      ]);
      recordCount = 1;
      payload = { revenue, products };
      break;
    }
    default:
      throw new ValidationError(`Unsupported seller export type: ${exportType}`);
  }

  const checksum = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");

  const record = await prisma.dataExport.create({
    data: {
      requesterType: "SELLER",
      requesterId: userId,
      businessId,
      exportType: `SELLER_${exportType.toUpperCase()}`,
      format: "JSON",
      status: "COMPLETED",
      recordCount,
      checksum,
    },
  });

  await logAuditEvent(businessId, userId, "SELLER_DATA_EXPORT", "DATA_EXPORT", record.id, {
    exportType,
    recordCount,
  });

  return {
    exportId: record.id,
    businessId,
    exportType,
    exportedAtUtc: new Date().toISOString(),
    recordCount,
    checksum,
    items: payload,
  };
}

/**
 * Safe buyer account deactivation / deletion workflow.
 * Anonymizes personal buyer PII and removes external identity links while strictly preserving
 * seller financial, order, refund, and ledger history required for legal/accounting compliance.
 */
export async function deactivateOrDeleteBuyerIdentity(
  userId: string,
  mode: "DEACTIVATE" | "DELETE",
  reason?: string
) {
  const identity = await prisma.buyerIdentity.findUnique({ where: { userId } });
  if (!identity) {
    throw new ValidationError("No active buyer identity associated with this user");
  }

  const now = new Date();
  const nextStatus =
    mode === "DELETE" ? BuyerIdentityStatus.DELETED : BuyerIdentityStatus.DEACTIVATED;

  const updated = await prisma.$transaction(async (tx) => {
    if (mode === "DELETE") {
      // Remove social & contact links and anonymize PII without deleting financial orders/ledger records
      await tx.buyerIdentityLink.deleteMany({
        where: { buyerIdentityId: identity.id },
      });

      const anonymized = await tx.buyerIdentity.update({
        where: { id: identity.id },
        data: {
          status: nextStatus,
          accountState: "DELETED",
          displayName: "Deleted User",
          avatarUrl: null,
          email: null,
          phone: null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          deletedAt: now,
          privacySettings: Prisma.JsonNull,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          name: "Deleted User",
          email: `deleted_${identity.id.slice(0, 8)}@deleted.orderflow.local`,
          passwordHash: null,
        },
      });

      return anonymized;
    }

    return tx.buyerIdentity.update({
      where: { id: identity.id },
      data: {
        status: nextStatus,
        accountState: "DEACTIVATED",
        deactivatedAt: now,
      },
    });
  });

  await recordIdentityEvent(prisma, identity.id, BuyerIdentityEventType.IDENTITY_DEACTIVATED, {
    actorType: "BUYER",
    actorUserId: userId,
    metadata: { mode, reason: reason || "User requested" },
  });

  return {
    buyerIdentityId: updated.id,
    status: updated.status,
    accountState: updated.accountState,
    financialRecordsPreserved: true,
  };
}
