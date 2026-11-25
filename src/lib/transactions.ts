import { prisma } from "./prisma";
import {
  SocialPlatform,
  SocialSurface,
  TransactionStatus,
  TimelineVisibility,
  TimelineActor,
  EvidenceType,
  EvidenceVerificationState,
  DisputeStatus,
  ChannelSyncStatus,
  OrderStatus,
  PaymentStatus,
  OrderSource,
  Prisma,
} from "@prisma/client";
import {
  SocialTransactionResponse,
  PublicTransactionResponse,
  CreateSocialTransactionInput,
  CreateTimelineEventInput,
  AddEvidenceInput,
  CreateDisputeInput,
  UpdateDisputeInput,
} from "@/types";
import { TenantAccessError } from "./tenant";
import { toMinorUnits, minorUnitsToMajorString } from "./money";
import { evaluateReturnEligibility, resolveOrderReturnPolicy } from "./returns";

/**
 * Maps legacy OrderSource enum to modern SocialPlatform & default SocialSurface
 */
export function mapOrderSourceToSocialContext(source: OrderSource): {
  platform: SocialPlatform;
  surface: SocialSurface;
} {
  switch (source) {
    case OrderSource.INSTAGRAM:
      return { platform: SocialPlatform.INSTAGRAM, surface: SocialSurface.DM };
    case OrderSource.WHATSAPP:
      return { platform: SocialPlatform.WHATSAPP, surface: SocialSurface.DIRECT_CHAT };
    case OrderSource.FACEBOOK:
      return { platform: SocialPlatform.FACEBOOK, surface: SocialSurface.MESSENGER };
    case OrderSource.X:
      return { platform: SocialPlatform.X, surface: SocialSurface.X_DM };
    case OrderSource.MARKETPLACE:
      return { platform: SocialPlatform.MARKETPLACE, surface: SocialSurface.MARKETPLACE };
    case OrderSource.API:
      return { platform: SocialPlatform.API, surface: SocialSurface.EXTERNAL_LINK };
    case OrderSource.ONLINE:
      return { platform: SocialPlatform.OTHER, surface: SocialSurface.EXTERNAL_LINK };
    case OrderSource.MANUAL:
    default:
      return { platform: SocialPlatform.MANUAL, surface: SocialSurface.MANUAL_ENTRY };
  }
}

/**
 * Creates a canonical SocialTransaction connecting social interaction, buyer, and order
 */
export async function createSocialTransaction(
  businessId: string,
  data: CreateSocialTransactionInput
) {
  return prisma.$transaction(async (tx) => {
    // 1. Create the Social Transaction
    const transaction = await tx.socialTransaction.create({
      data: {
        businessId,
        orderId: data.orderId || null,
        customerId: data.customerId || null,
        conversationId: data.conversationId || null,
        platform: data.platform || SocialPlatform.MANUAL,
        surface: data.surface || SocialSurface.MANUAL_ENTRY,
        status: data.status || TransactionStatus.INQUIRY,
        externalUserId: data.externalUserId,
        externalConversationId: data.externalConversationId,
        externalListingId: data.externalListingId,
        externalPostId: data.externalPostId,
        sourceUrl: data.sourceUrl,
        buyerNotes: data.buyerNotes,
        sellerNotes: data.sellerNotes,
        metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    // 2. Automatically record initial timeline event
    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: transaction.id,
        eventType: "TRANSACTION_INITIALIZED",
        title: "Social Transaction Initiated",
        description: `Interaction captured from ${transaction.platform} via ${transaction.surface}`,
        actor: TimelineActor.SYSTEM,
        visibility: TimelineVisibility.PUBLIC,
      },
    });

    // 3. If originating from conversation, attach initial evidence
    if (data.conversationId) {
      await tx.transactionEvidence.create({
        data: {
          transactionId: transaction.id,
          evidenceType: EvidenceType.ORIGINAL_MESSAGE,
          verificationState: EvidenceVerificationState.OBSERVED,
          source: `${transaction.platform}_CONVERSATION`,
          actor: TimelineActor.BUYER,
          notes: `Originating conversation ID: ${data.conversationId}`,
        },
      });
    }

    return transaction;
  });
}

/**
 * Fetches seller-facing transaction details by ID with multi-tenant verification
 */
export async function getSocialTransactionById(
  businessId: string,
  transactionId: string
) {
  const transaction = await prisma.socialTransaction.findFirst({
    where: {
      id: transactionId,
      businessId,
    },
    include: {
      order: {
        include: {
          items: true,
          shipments: true,
          payments: true,
        },
      },
      customer: true,
      conversation: true,
      timelineEvents: {
        orderBy: { createdAt: "desc" },
      },
      evidence: {
        orderBy: { createdAt: "desc" },
      },
      disputes: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!transaction) {
    throw new TenantAccessError("Transaction not found in this business");
  }

  return transaction;
}

/**
 * Adds an auditable timeline event to a transaction
 */
export async function addTimelineEvent(
  businessId: string,
  transactionId: string,
  data: CreateTimelineEventInput
) {
  const transaction = await prisma.socialTransaction.findFirst({
    where: { id: transactionId, businessId },
  });

  if (!transaction) {
    throw new TenantAccessError("Transaction not found in this business");
  }

  return prisma.transactionTimelineEvent.create({
    data: {
      transactionId,
      eventType: data.eventType,
      title: data.title,
      description: data.description,
      actor: data.actor as TimelineActor,
      visibility: data.visibility as TimelineVisibility,
      metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

/**
 * Attaches cryptographic/social evidence to a transaction
 */
export async function addEvidence(
  businessId: string,
  transactionId: string,
  data: AddEvidenceInput
) {
  const transaction = await prisma.socialTransaction.findFirst({
    where: { id: transactionId, businessId },
  });

  if (!transaction) {
    throw new TenantAccessError("Transaction not found in this business");
  }

  return prisma.transactionEvidence.create({
    data: {
      transactionId,
      evidenceType: data.evidenceType as EvidenceType,
      verificationState: (data.verificationState as EvidenceVerificationState) || EvidenceVerificationState.OBSERVED,
      source: data.source || "MANUAL_UPLOAD",
      actor: (data.actor as TimelineActor) || TimelineActor.SYSTEM,
      mediaUrl: data.mediaUrl,
      notes: data.notes,
      metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });
}

/**
 * Calculates factual, transparent Seller Trust Metrics for public buyer inspection
 */
export async function getSellerTrustMetrics(businessId: string) {
  const [totalOrders, completedOrders, verifiedPayments, totalDisputes] = await Promise.all([
    prisma.order.count({ where: { businessId } }),
    prisma.order.count({
      where: {
        businessId,
        status: { in: [OrderStatus.DELIVERED, OrderStatus.PROCESSING, OrderStatus.SHIPPED] },
      },
    }),
    prisma.payment.count({
      where: {
        businessId,
        status: "VERIFIED",
      },
    }),
    prisma.transactionDispute.count({
      where: { businessId },
    }),
  ]);

  const deliveryFulfillmentRate =
    totalOrders > 0 ? Number(((completedOrders / totalOrders) * 100).toFixed(1)) : 100.0;
  const verifiedPaymentRate =
    totalOrders > 0
      ? Number((Math.min(100, (verifiedPayments / totalOrders) * 100)).toFixed(1))
      : 100.0;

  return {
    completedOrdersCount: completedOrders,
    deliveryFulfillmentRate,
    verifiedPaymentRate,
    isVerifiedSeller: completedOrders >= 5 && deliveryFulfillmentRate >= 90,
  };
}

/**
 * Returns a strictly sanitized, buyer-safe projection for the Public Transaction Room (/t/[token]).
 * NEVER exposes internal seller notes, cost prices, profit margins, or internal audit logs.
 */
export async function getPublicTransactionByToken(
  token: string
): Promise<PublicTransactionResponse | null> {
  const transaction = await prisma.socialTransaction.findUnique({
    where: { publicTrackingToken: token },
    include: {
      business: {
        include: {
          profile: true,
        },
      },
      order: {
        include: {
          items: true,
          payments: {
            where: { status: "VERIFIED" },
            orderBy: { createdAt: "desc" },
          },
          shipments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              trackingEvents: {
                orderBy: { occurredAt: "desc" },
                take: 10,
              },
            },
          },
          refunds: {
            orderBy: { createdAt: "desc" },
          },
          returns: {
            orderBy: { createdAt: "desc" },
            include: { items: true },
          },
        },
      },
      timelineEvents: {
        where: { visibility: TimelineVisibility.PUBLIC },
        orderBy: { createdAt: "asc" },
      },
      evidence: {
        where: {
          verificationState: {
            in: [
              EvidenceVerificationState.OBSERVED,
              EvidenceVerificationState.BUYER_CONFIRMED,
              EvidenceVerificationState.SELLER_CONFIRMED,
              EvidenceVerificationState.SYSTEM_GENERATED,
            ],
          },
        },
        orderBy: { createdAt: "desc" },
      },
      disputes: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!transaction) return null;

  const trustMetrics = await getSellerTrustMetrics(transaction.businessId);

  let returnEligibility: { eligible: boolean; reasons: string[]; returnWindowDays: number } | null = null;
  if (transaction.order) {
    const policy = resolveOrderReturnPolicy(transaction.order);
    const evalRes = evaluateReturnEligibility({
      order: {
        status: transaction.order.status,
        paymentStatus: transaction.order.paymentStatus,
        createdAt: transaction.order.createdAt,
        currency: transaction.order.currency,
        amountPaid: transaction.order.amountPaid,
        refundedAmountMinorUnits: transaction.order.refundedAmountMinorUnits || 0,
        shipments: transaction.order.shipments,
        items: transaction.order.items,
        returns: transaction.order.returns,
      },
      policy,
    });
    returnEligibility = {
      eligible: evalRes.eligible,
      reasons: evalRes.reasons,
      returnWindowDays: policy.returnWindowDays,
    };
  }

  const orderTotalMinor = transaction.order
    ? toMinorUnits(transaction.order.totalAmount, transaction.order.currency)
    : 0;
  const orderPaidMinor = transaction.order
    ? toMinorUnits(transaction.order.amountPaid, transaction.order.currency)
    : 0;
  const outstandingMinor = Math.max(0, orderTotalMinor - orderPaidMinor);
  const refundedMinor = transaction.order?.refundedAmountMinorUnits || 0;

  return {
    id: transaction.id,
    publicTrackingToken: transaction.publicTrackingToken,
    platform: transaction.platform,
    surface: transaction.surface,
    status: transaction.status,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
    seller: {
      name: transaction.business.name,
      slug: transaction.business.slug,
      currency: transaction.business.currency,
      logoUrl: transaction.business.logoUrl,
      instagramHandle: transaction.business.profile?.instagramHandle,
      whatsappNumber: transaction.business.profile?.whatsappNumber,
      metrics: trustMetrics,
    },
    order: transaction.order
      ? {
          orderNumber: transaction.order.orderNumber,
          status: transaction.order.status,
          fulfillmentStatus: transaction.order.fulfillmentStatus,
          paymentStatus: transaction.order.paymentStatus,
          totalAmount: Number(transaction.order.totalAmount),
          amountPaid: Number(transaction.order.amountPaid),
          outstandingBalance: Number(
            minorUnitsToMajorString(outstandingMinor, transaction.order.currency)
          ),
          refundedAmount: Number(
            minorUnitsToMajorString(refundedMinor, transaction.order.currency)
          ),
          currency: transaction.order.currency,
          shippingAddress: transaction.order.shippingAddress,
          items: transaction.order.items.map((item) => ({
            id: item.id,
            title: item.title,
            variantTitle: item.variantTitle,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            totalPrice: Number(item.totalPrice),
          })),
          payments: transaction.order.payments.map((p) => ({
            amount: Number(p.amount),
            method: p.method,
            status: p.status,
            referenceNumber: p.referenceNumber,
            createdAt: p.createdAt.toISOString(),
          })),
          shipment: transaction.order.shipments[0]
            ? {
                carrier: transaction.order.shipments[0].carrier,
                trackingNumber: transaction.order.shipments[0].trackingNumber,
                trackingUrl: transaction.order.shipments[0].trackingUrl,
                status: transaction.order.shipments[0].status,
                estimatedDelivery: transaction.order.shipments[0].estimatedDelivery?.toISOString() || null,
                actualDelivery: transaction.order.shipments[0].actualDelivery?.toISOString() || null,
                latestEvent: transaction.order.shipments[0].trackingEvents?.[0]
                  ? {
                      status: transaction.order.shipments[0].trackingEvents[0].status,
                      description: transaction.order.shipments[0].trackingEvents[0].description,
                      location: transaction.order.shipments[0].trackingEvents[0].location,
                      occurredAt: transaction.order.shipments[0].trackingEvents[0].occurredAt.toISOString(),
                    }
                  : null,
                trackingEvents: (transaction.order.shipments[0].trackingEvents || []).map((te) => ({
                  status: te.status,
                  description: te.description,
                  location: te.location,
                  occurredAt: te.occurredAt.toISOString(),
                })),
              }
            : null,
          refunds: (transaction.order.refunds || []).map((r) => ({
            id: r.id,
            status: r.status,
            type: r.type,
            amountMinorUnits: r.amountMinorUnits,
            currency: r.currency,
            reason: r.reason,
            processedAt: r.processedAt ? r.processedAt.toISOString() : null,
            createdAt: r.createdAt.toISOString(),
          })),
          returns: (transaction.order.returns || []).map((ret) => ({
            id: ret.id,
            status: ret.status,
            reason: ret.reason,
            requestedAmountMinorUnits: ret.requestedAmountMinorUnits,
            approvedAmountMinorUnits: ret.approvedAmountMinorUnits,
            currency: ret.currency,
            trackingNumber: ret.trackingNumber,
            carrier: ret.carrier,
            returnLabelUrl: ret.returnLabelUrl,
            sellerResponse: ret.sellerResponse,
            createdAt: ret.createdAt.toISOString(),
            updatedAt: ret.updatedAt.toISOString(),
          })),
          returnEligibility,
        }
      : null,
    timeline: transaction.timelineEvents.map((evt) => ({
      title: evt.title,
      description: evt.description,
      actor: evt.actor,
      createdAt: evt.createdAt.toISOString(),
    })),
    evidence: transaction.evidence.map((ev) => ({
      evidenceType: ev.evidenceType,
      verificationState: ev.verificationState,
      mediaUrl: ev.mediaUrl,
      notes: ev.notes,
      createdAt: ev.createdAt.toISOString(),
    })),
    disputes: transaction.disputes.map((d) => ({
      id: d.id,
      reason: d.reason,
      status: d.status,
      buyerNotes: d.buyerNotes,
      sellerResponse: d.sellerResponse,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

/**
 * Creates a buyer-initiated dispute/return from the public shared transaction room
 */
export async function createPublicDispute(
  token: string,
  data: CreateDisputeInput
) {
  const transaction = await prisma.socialTransaction.findUnique({
    where: { publicTrackingToken: token },
  });

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  return prisma.$transaction(async (tx) => {
    // 1. Create dispute
    const dispute = await tx.transactionDispute.create({
      data: {
        transactionId: transaction.id,
        orderId: transaction.orderId,
        businessId: transaction.businessId,
        reason: data.reason,
        status: DisputeStatus.REQUESTED,
        refundAmount: data.refundAmount !== undefined && data.refundAmount !== null ? new Prisma.Decimal(data.refundAmount) : null,
        buyerNotes: data.buyerNotes,
        evidenceUrls: data.evidenceUrls || [],
      },
    });

    // 2. Append public timeline event
    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: transaction.id,
        eventType: "DISPUTE_RAISED",
        title: "Dispute / Return Initiated by Buyer",
        description: `Reason: ${data.reason}`,
        actor: TimelineActor.BUYER,
        visibility: TimelineVisibility.PUBLIC,
      },
    });

    // 3. Update transaction status
    await tx.socialTransaction.update({
      where: { id: transaction.id },
      data: { status: TransactionStatus.DISPUTED },
    });

    return dispute;
  });
}

/**
 * Updates a dispute by the seller (accept, reject, refund)
 */
export async function updateDisputeStatus(
  businessId: string,
  disputeId: string,
  data: UpdateDisputeInput
) {
  const dispute = await prisma.transactionDispute.findFirst({
    where: { id: disputeId, businessId },
    include: { transaction: true },
  });

  if (!dispute) {
    throw new TenantAccessError("Dispute record not found");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.transactionDispute.update({
      where: { id: disputeId },
      data: {
        status: data.status as DisputeStatus,
        sellerResponse: data.sellerResponse,
        resolutionNotes: data.resolutionNotes,
        refundAmount: data.refundAmount !== undefined && data.refundAmount !== null ? new Prisma.Decimal(data.refundAmount) : dispute.refundAmount,
        resolvedAt: ["APPROVED", "REJECTED", "REFUNDED", "CLOSED"].includes(data.status)
          ? new Date()
          : null,
      },
    });

    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: dispute.transactionId,
        eventType: `DISPUTE_${data.status}`,
        title: `Dispute Status Updated: ${data.status}`,
        description: data.sellerResponse || data.resolutionNotes || `Status updated to ${data.status}`,
        actor: TimelineActor.SELLER,
        visibility: TimelineVisibility.PUBLIC,
      },
    });

    if (data.status === "REFUNDED") {
      await tx.socialTransaction.update({
        where: { id: dispute.transactionId },
        data: { status: TransactionStatus.REFUNDED },
      });
    }

    return updated;
  });
}

/**
 * Returns breakdown analytics across Social Platforms and Surfaces for the seller dashboard
 */
export async function getSocialCommerceAnalytics(businessId: string) {
  const transactions = await prisma.socialTransaction.findMany({
    where: { businessId },
    include: {
      order: {
        select: {
          totalAmount: true,
          status: true,
          paymentStatus: true,
        },
      },
    },
  });

  const platformBreakdown: Record<
    string,
    { count: number; revenue: number; completedCount: number }
  > = {
    INSTAGRAM: { count: 0, revenue: 0, completedCount: 0 },
    WHATSAPP: { count: 0, revenue: 0, completedCount: 0 },
    FACEBOOK: { count: 0, revenue: 0, completedCount: 0 },
    X: { count: 0, revenue: 0, completedCount: 0 },
    MANUAL: { count: 0, revenue: 0, completedCount: 0 },
    OTHER: { count: 0, revenue: 0, completedCount: 0 },
  };

  const surfaceBreakdown: Record<string, { count: number; revenue: number }> = {};

  for (const t of transactions) {
    const plat = t.platform;
    const surf = t.surface;
    const orderTotal = t.order ? Number(t.order.totalAmount) : 0;
    const isCompleted =
      t.order?.status === OrderStatus.DELIVERED || t.status === TransactionStatus.COMPLETED;

    if (!platformBreakdown[plat]) {
      platformBreakdown[plat] = { count: 0, revenue: 0, completedCount: 0 };
    }
    platformBreakdown[plat].count += 1;
    platformBreakdown[plat].revenue += orderTotal;
    if (isCompleted) {
      platformBreakdown[plat].completedCount += 1;
    }

    if (!surfaceBreakdown[surf]) {
      surfaceBreakdown[surf] = { count: 0, revenue: 0 };
    }
    surfaceBreakdown[surf].count += 1;
    surfaceBreakdown[surf].revenue += orderTotal;
  }

  return {
    totalTransactions: transactions.length,
    platformBreakdown,
    surfaceBreakdown,
  };
}
