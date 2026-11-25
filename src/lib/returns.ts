import crypto from "crypto";
import { prisma } from "./prisma";
import {
  ReturnStatus,
  ReturnReason,
  RefundType,
  OrderStatus,
  PaymentStatus,
  DeliveryPartner,
  TimelineActor,
  TimelineVisibility,
  EvidenceType,
  EvidenceVerificationState,
  Prisma,
} from "@prisma/client";
import {
  assertValidMinorUnits,
  toMinorUnits,
  minorUnitsToMajorString,
  calculatePercentageMinorUnits,
} from "./money";
import { assertValidTransition, RETURN_TRANSITIONS } from "./state-machines";
import { requestRefund } from "./refunds";
import { NotFoundError, ReturnError, ValidationError } from "./errors";
import { logger } from "./logger";

export interface ReturnPolicySnapshot {
  returnWindowDays: number;
  allowPartialReturn: boolean;
  restockingFeePercent: number;
  requiresInspection: boolean;
  requiresEvidenceForDamagedOrWrong: boolean;
  allowedOrderStatuses: OrderStatus[];
}

export const DEFAULT_RETURN_POLICY: ReturnPolicySnapshot = {
  returnWindowDays: 14,
  allowPartialReturn: true,
  restockingFeePercent: 0,
  requiresInspection: true,
  requiresEvidenceForDamagedOrWrong: false,
  allowedOrderStatuses: [OrderStatus.DELIVERED, OrderStatus.SHIPPED],
};

export interface ReturnEligibilityResult {
  eligible: boolean;
  reasons: string[];
  daysSinceOrder: number;
  daysSinceDelivery: number | null;
  maxReturnableMinorUnits: number;
}

export interface CreateReturnRequestInput {
  orderId: string;
  reason: ReturnReason;
  buyerNotes?: string | null;
  evidenceUrls?: string[];
  disputeId?: string | null;
  items?: Array<{
    orderItemId: string;
    quantity: number;
    reason?: string | null;
  }>;
}

/**
 * Resolves the authoritative ReturnPolicySnapshot anchored at order creation (or default).
 */
export function resolveOrderReturnPolicy(order: { returnPolicy?: unknown }): ReturnPolicySnapshot {
  if (order.returnPolicy && typeof order.returnPolicy === "object") {
    const raw = order.returnPolicy as Partial<ReturnPolicySnapshot>;
    return {
      returnWindowDays: raw.returnWindowDays ?? DEFAULT_RETURN_POLICY.returnWindowDays,
      allowPartialReturn: raw.allowPartialReturn ?? DEFAULT_RETURN_POLICY.allowPartialReturn,
      restockingFeePercent: raw.restockingFeePercent ?? DEFAULT_RETURN_POLICY.restockingFeePercent,
      requiresInspection: raw.requiresInspection ?? DEFAULT_RETURN_POLICY.requiresInspection,
      requiresEvidenceForDamagedOrWrong:
        raw.requiresEvidenceForDamagedOrWrong ??
        DEFAULT_RETURN_POLICY.requiresEvidenceForDamagedOrWrong,
      allowedOrderStatuses:
        raw.allowedOrderStatuses && Array.isArray(raw.allowedOrderStatuses)
          ? raw.allowedOrderStatuses
          : DEFAULT_RETURN_POLICY.allowedOrderStatuses,
    };
  }
  return { ...DEFAULT_RETURN_POLICY };
}

/**
 * Evaluates deterministic return eligibility against the order's frozen policy snapshot
 * and previously submitted/returned item quantities.
 */
export function evaluateReturnEligibility(params: {
  order: {
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    createdAt: Date;
    currency: string;
    amountPaid: Prisma.Decimal;
    refundedAmountMinorUnits: number;
    shipments: Array<{ actualDelivery: Date | null }>;
    items: Array<{ id: string; quantity: number; unitPrice: Prisma.Decimal }>;
    returns: Array<{
      status: ReturnStatus;
      items: Array<{ orderItemId: string; quantity: number }>;
    }>;
  };
  policy: ReturnPolicySnapshot;
  requestedItems?: Array<{ orderItemId: string; quantity: number }>;
  referenceDate?: Date;
}): ReturnEligibilityResult {
  const { order, policy, requestedItems } = params;
  const now = params.referenceDate ?? new Date();
  const reasons: string[] = [];

  if (!policy.allowedOrderStatuses.includes(order.status)) {
    reasons.push(
      `Order status ${order.status} is not eligible for return (allowed: ${policy.allowedOrderStatuses.join(", ")})`
    );
  }

  const paidMinor = toMinorUnits(order.amountPaid, order.currency);
  const maxReturnableMinorUnits = Math.max(0, paidMinor - (order.refundedAmountMinorUnits || 0));

  const deliveredAt = order.shipments.find((s) => s.actualDelivery)?.actualDelivery || null;
  const anchorDate = deliveredAt || order.createdAt;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSinceOrder = Math.max(0, Math.floor((now.getTime() - order.createdAt.getTime()) / msPerDay));
  const daysSinceDelivery = deliveredAt
    ? Math.max(0, Math.floor((now.getTime() - deliveredAt.getTime()) / msPerDay))
    : null;
  const windowDaysElapsed = Math.max(0, Math.floor((now.getTime() - anchorDate.getTime()) / msPerDay));

  if (windowDaysElapsed > policy.returnWindowDays) {
    reasons.push(
      `Return window of ${policy.returnWindowDays} days has expired (${windowDaysElapsed} days elapsed)`
    );
  }

  // Validate requested item quantities against previously active/completed returns
  if (requestedItems && requestedItems.length > 0) {
    if (!policy.allowPartialReturn && requestedItems.length < order.items.length) {
      reasons.push("Order policy does not allow partial returns");
    }

    const alreadyReturnedQty = new Map<string, number>();
    for (const ret of order.returns) {
      if (ret.status === ReturnStatus.REJECTED || ret.status === ReturnStatus.CANCELLED) {
        continue;
      }
      for (const ri of ret.items) {
        alreadyReturnedQty.set(
          ri.orderItemId,
          (alreadyReturnedQty.get(ri.orderItemId) || 0) + ri.quantity
        );
      }
    }

    const itemLookup = new Map(order.items.map((i) => [i.id, i]));
    for (const reqItem of requestedItems) {
      const orderItem = itemLookup.get(reqItem.orderItemId);
      if (!orderItem) {
        reasons.push(`Order item ${reqItem.orderItemId} does not belong to this order`);
        continue;
      }
      if (!Number.isInteger(reqItem.quantity) || reqItem.quantity < 1) {
        reasons.push(`Invalid return quantity for item ${reqItem.orderItemId}`);
        continue;
      }
      const prevQty = alreadyReturnedQty.get(orderItem.id) || 0;
      const availableQty = Math.max(0, orderItem.quantity - prevQty);
      if (reqItem.quantity > availableQty) {
        reasons.push(
          `Return quantity (${reqItem.quantity}) exceeds available returnable quantity (${availableQty}) for item ${orderItem.id}`
        );
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    daysSinceOrder,
    daysSinceDelivery,
    maxReturnableMinorUnits,
  };
}

/**
 * Creates a ReturnRequest with frozen policy snapshot, item-level breakdown,
 * timeline entry, and TransactionEvidence provenance.
 */
export async function createReturnRequest(
  businessId: string,
  input: CreateReturnRequestInput,
  options?: { buyerIdentityId?: string | null; actorType?: "BUYER" | "SELLER"; bypassPolicyWindow?: boolean }
) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, businessId },
    include: {
      items: true,
      shipments: { orderBy: { createdAt: "desc" } },
      returns: { include: { items: true } },
      socialTransaction: true,
    },
  });

  if (!order) {
    throw new NotFoundError("Order not found in business tenant");
  }

  const policy = resolveOrderReturnPolicy(order);
  const requestedItems =
    input.items && input.items.length > 0
      ? input.items
      : order.items.map((item) => ({
          orderItemId: item.id,
          quantity: item.quantity,
          reason: input.reason,
        }));

  if (requestedItems.length === 0) {
    throw new ReturnError("Order has no items eligible for return");
  }

  const eligibility = evaluateReturnEligibility({
    order,
    policy,
    requestedItems,
  });

  if (!eligibility.eligible && !options?.bypassPolicyWindow) {
    throw new ReturnError(eligibility.reasons[0] || "Order is not eligible for return", {
      reasons: eligibility.reasons,
    });
  }

  const itemLookup = new Map(order.items.map((i) => [i.id, i]));
  let requestedSubtotalMinor = 0;
  const resolvedItems = requestedItems.map((ri) => {
    const orderItem = itemLookup.get(ri.orderItemId);
    if (!orderItem) {
      throw new ReturnError(`OrderItem ${ri.orderItemId} not found in order`);
    }
    const unitMinor = toMinorUnits(orderItem.unitPrice, order.currency);
    requestedSubtotalMinor += unitMinor * ri.quantity;
    return {
      orderItemId: orderItem.id,
      quantity: ri.quantity,
      unitPriceMinorUnits: unitMinor,
      reason: ri.reason || null,
    };
  });

  const restockingFeeMinor =
    policy.restockingFeePercent > 0
      ? calculatePercentageMinorUnits(requestedSubtotalMinor, policy.restockingFeePercent)
      : 0;
  const paidMinor = toMinorUnits(order.amountPaid, order.currency);
  const refundableCap = Math.max(0, paidMinor - (order.refundedAmountMinorUnits || 0));
  const requestedAmountMinorUnits = Math.min(
    Math.max(0, requestedSubtotalMinor - restockingFeeMinor),
    refundableCap > 0 ? refundableCap : requestedSubtotalMinor
  );

  return prisma.$transaction(async (tx) => {
    const returnRequest = await tx.returnRequest.create({
      data: {
        businessId,
        orderId: order.id,
        socialTransactionId: order.socialTransaction?.id ?? null,
        customerId: order.customerId ?? null,
        buyerIdentityId: options?.buyerIdentityId ?? order.socialTransaction?.buyerIdentityId ?? null,
        disputeId: input.disputeId ?? null,
        status: ReturnStatus.REQUESTED,
        reason: input.reason,
        buyerNotes: input.buyerNotes ?? null,
        policySnapshot: policy as unknown as Prisma.InputJsonValue,
        eligibilityResult: eligibility as unknown as Prisma.InputJsonValue,
        requestedAmountMinorUnits,
        currency: order.currency,
        evidenceUrls: input.evidenceUrls ?? [],
        items: {
          create: resolvedItems,
        },
      },
      include: { items: true },
    });

    if (order.socialTransaction) {
      await tx.transactionTimelineEvent.create({
        data: {
          transactionId: order.socialTransaction.id,
          eventType: "RETURN_REQUESTED",
          title: `Return Requested (${input.reason.replace(/_/g, " ")})`,
          description:
            input.buyerNotes ||
            `Requested return for ${resolvedItems.length} item(s), est. refund ${order.currency} ${minorUnitsToMajorString(requestedAmountMinorUnits, order.currency)}`,
          actor:
            options?.actorType === "SELLER" ? TimelineActor.SELLER : TimelineActor.BUYER,
          visibility: TimelineVisibility.PUBLIC,
          metadata: {
            returnRequestId: returnRequest.id,
            reason: input.reason,
            requestedAmountMinorUnits,
          },
        },
      });

      await tx.transactionEvidence.create({
        data: {
          transactionId: order.socialTransaction.id,
          disputeId: input.disputeId ?? null,
          evidenceType: EvidenceType.RETURN_REQUEST,
          verificationState: EvidenceVerificationState.USER_PROVIDED,
          source: options?.actorType === "SELLER" ? "SELLER_PORTAL" : "BUYER_PORTAL",
          actor:
            options?.actorType === "SELLER" ? TimelineActor.SELLER : TimelineActor.BUYER,
          mediaUrl: input.evidenceUrls?.[0] ?? null,
          notes: `Return ${returnRequest.id}: ${input.reason} — ${input.buyerNotes || "No notes"}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        businessId,
        action: "RETURN_REQUEST_CREATED",
        entityType: "RETURN_REQUEST",
        entityId: returnRequest.id,
        metadata: {
          orderId: order.id,
          reason: input.reason,
          requestedAmountMinorUnits,
          itemCount: resolvedItems.length,
        },
      },
    });

    logger.info("returns.created", {
      returnRequestId: returnRequest.id,
      businessId,
      orderId: order.id,
      reason: input.reason,
    });

    return returnRequest;
  });
}

/**
 * Transitions return status cleanly through RETURN_TRANSITIONS state machine.
 */
export async function updateReturnStatus(
  businessId: string,
  returnRequestId: string,
  input: {
    status: ReturnStatus;
    sellerResponse?: string | null;
    approvedAmountMinorUnits?: number | null;
    carrier?: DeliveryPartner | null;
    trackingNumber?: string | null;
    returnLabelUrl?: string | null;
    inspectionNotes?: string | null;
    inspectionPassed?: boolean | null;
    restockInventory?: boolean;
    issueRefund?: boolean;
  },
  actorUserId?: string
) {
  const existing = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, businessId },
    include: {
      items: { include: { orderItem: true } },
      order: { include: { socialTransaction: true } },
    },
  });

  if (!existing) {
    throw new NotFoundError("Return request not found in business tenant");
  }

  assertValidTransition("ReturnRequest", RETURN_TRANSITIONS, existing.status, input.status, {
    allowSameState: false,
  });

  if (
    input.approvedAmountMinorUnits !== undefined &&
    input.approvedAmountMinorUnits !== null
  ) {
    assertValidMinorUnits(input.approvedAmountMinorUnits, "approvedAmountMinorUnits");
  }

  const now = new Date();
  let returnLabelUrl = input.returnLabelUrl ?? existing.returnLabelUrl;
  let trackingNumber = input.trackingNumber ?? existing.trackingNumber;

  if (input.status === ReturnStatus.LABEL_CREATED && !trackingNumber) {
    const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    trackingNumber = `RET-${suffix}`;
    returnLabelUrl =
      returnLabelUrl || `https://labels.orderflow.internal/returns/${trackingNumber}.pdf`;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const ret = await tx.returnRequest.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        sellerResponse:
          input.sellerResponse !== undefined ? input.sellerResponse : existing.sellerResponse,
        approvedAmountMinorUnits:
          input.approvedAmountMinorUnits !== undefined
            ? input.approvedAmountMinorUnits
            : input.status === ReturnStatus.APPROVED
            ? existing.approvedAmountMinorUnits ?? existing.requestedAmountMinorUnits
            : existing.approvedAmountMinorUnits,
        carrier: input.carrier ?? existing.carrier,
        trackingNumber,
        returnLabelUrl,
        inspectionNotes:
          input.inspectionNotes !== undefined
            ? input.inspectionNotes
            : existing.inspectionNotes,
        inspectionPassed:
          input.inspectionPassed !== undefined
            ? input.inspectionPassed
            : existing.inspectionPassed,
        ...(input.status === ReturnStatus.APPROVED ? { approvedAt: now } : {}),
        ...(input.status === ReturnStatus.REJECTED ? { rejectedAt: now } : {}),
        ...(input.status === ReturnStatus.RECEIVED ? { receivedAt: now } : {}),
        ...(input.status === ReturnStatus.INSPECTED ? { inspectedAt: now } : {}),
        ...(input.status === ReturnStatus.REFUNDED ? { refundedAt: now } : {}),
      },
      include: { items: true },
    });

    // Optionally restock returned inventory when received/inspected cleanly
    if (
      input.restockInventory &&
      (input.status === ReturnStatus.RECEIVED ||
        (input.status === ReturnStatus.INSPECTED && input.inspectionPassed !== false))
    ) {
      for (const ri of existing.items) {
        if (ri.orderItem.variantId) {
          await tx.productVariant.update({
            where: { id: ri.orderItem.variantId },
            data: { stockQuantity: { increment: ri.quantity } },
          });
        } else if (ri.orderItem.productId) {
          await tx.product.update({
            where: { id: ri.orderItem.productId },
            data: { stockQuantity: { increment: ri.quantity } },
          });
        }
      }
    }

    if (existing.order.socialTransaction) {
      await tx.transactionTimelineEvent.create({
        data: {
          transactionId: existing.order.socialTransaction.id,
          eventType: `RETURN_${input.status}`,
          title: `Return Status: ${input.status.replace(/_/g, " ")}`,
          description:
            input.sellerResponse ||
            input.inspectionNotes ||
            `Return #${existing.id.slice(0, 8)} moved to ${input.status}`,
          actor: TimelineActor.SELLER,
          visibility: TimelineVisibility.PUBLIC,
          metadata: {
            returnRequestId: existing.id,
            status: input.status,
            trackingNumber,
          },
        },
      });

      if (input.status === ReturnStatus.IN_TRANSIT && trackingNumber) {
        await tx.transactionEvidence.create({
          data: {
            transactionId: existing.order.socialTransaction.id,
            disputeId: existing.disputeId ?? null,
            evidenceType: EvidenceType.RETURN_TRACKING,
            verificationState: EvidenceVerificationState.SYSTEM_GENERATED,
            source: "RETURN_LOGISTICS",
            actor: TimelineActor.CARRIER,
            notes: `Return tracking ${trackingNumber} (${input.carrier || existing.carrier || "MANUAL"})`,
          },
        });
      }

      if (input.status === ReturnStatus.INSPECTED) {
        await tx.transactionEvidence.create({
          data: {
            transactionId: existing.order.socialTransaction.id,
            disputeId: existing.disputeId ?? null,
            evidenceType: EvidenceType.RETURN_INSPECTION,
            verificationState: EvidenceVerificationState.SELLER_CONFIRMED,
            source: "WAREHOUSE_INSPECTION",
            actor: TimelineActor.SELLER,
            notes: `Inspection ${input.inspectionPassed === false ? "FAILED" : "PASSED"}: ${input.inspectionNotes || ""}`,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        businessId,
        userId: actorUserId || null,
        action: `RETURN_STATUS_${input.status}`,
        entityType: "RETURN_REQUEST",
        entityId: existing.id,
        metadata: {
          previousStatus: existing.status,
          newStatus: input.status,
          orderId: existing.orderId,
          inspectionPassed: input.inspectionPassed,
        },
      },
    });

    return ret;
  });

  // Trigger return refund if requested and authorized
  let refund = null;
  if (
    input.issueRefund &&
    (input.status === ReturnStatus.RECEIVED ||
      (input.status === ReturnStatus.INSPECTED && input.inspectionPassed !== false) ||
      input.status === ReturnStatus.REFUND_PENDING)
  ) {
    const refundAmount =
      updated.approvedAmountMinorUnits ?? existing.requestedAmountMinorUnits;
    if (refundAmount > 0) {
      refund = await requestRefund(
        businessId,
        {
          orderId: existing.orderId,
          returnRequestId: existing.id,
          disputeId: existing.disputeId ?? undefined,
          type: RefundType.RETURN_REFUND,
          amountMinorUnits: refundAmount,
          currency: existing.currency,
          reason: `Return ${existing.id.slice(0, 8)} refund (${existing.reason})`,
          idempotencyKey: `return-refund:${existing.id}`,
          processImmediately: true,
        },
        actorUserId
      );
    }
  }

  return {
    returnRequest: updated,
    refund,
  };
}

export async function receiveAndInspectReturn(
  businessId: string,
  returnRequestId: string,
  input: {
    inspectionPassed: boolean;
    inspectionNotes?: string;
    restockInventory?: boolean;
    issueRefund?: boolean;
    approvedAmountMinorUnits?: number;
  },
  actorUserId?: string
) {
  const current = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, businessId },
  });
  if (!current) {
    throw new NotFoundError("Return request not found in business tenant");
  }

  // First receive if not yet received
  if (
    current.status === ReturnStatus.APPROVED ||
    current.status === ReturnStatus.LABEL_CREATED ||
    current.status === ReturnStatus.IN_TRANSIT
  ) {
    await updateReturnStatus(
      businessId,
      returnRequestId,
      { status: ReturnStatus.RECEIVED },
      actorUserId
    );
  }

  return updateReturnStatus(
    businessId,
    returnRequestId,
    {
      status: ReturnStatus.INSPECTED,
      inspectionPassed: input.inspectionPassed,
      inspectionNotes: input.inspectionNotes,
      restockInventory: input.restockInventory ?? input.inspectionPassed,
      issueRefund: input.issueRefund ?? input.inspectionPassed,
      approvedAmountMinorUnits: input.approvedAmountMinorUnits,
    },
    actorUserId
  );
}

export async function getReturns(
  businessId: string,
  filter?: {
    orderId?: string;
    status?: ReturnStatus;
    page?: number;
    limit?: number;
  }
) {
  const page = Math.max(1, filter?.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.ReturnRequestWhereInput = {
    businessId,
    ...(filter?.orderId ? { orderId: filter.orderId } : {}),
    ...(filter?.status ? { status: filter.status } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.returnRequest.count({ where }),
    prisma.returnRequest.findMany({
      where,
      include: {
        order: { select: { id: true, orderNumber: true, totalAmount: true, currency: true } },
        items: {
          include: {
            orderItem: { select: { id: true, title: true, variantTitle: true, quantity: true } },
          },
        },
        refunds: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  return {
    items,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getReturnById(businessId: string, returnRequestId: string) {
  const ret = await prisma.returnRequest.findFirst({
    where: { id: returnRequestId, businessId },
    include: {
      order: {
        include: {
          items: true,
          customer: { select: { id: true, name: true, email: true, phone: true } },
        },
      },
      items: { include: { orderItem: true } },
      refunds: true,
    },
  });
  if (!ret) {
    throw new NotFoundError("Return request not found in business tenant");
  }
  return ret;
}
