import crypto from "crypto";
import { prisma } from "./prisma";
import {
  DisputeStatus,
  DisputeCategory,
  DisputeDecisionRecommendation,
  EvidenceType,
  EvidenceVerificationState,
  TimelineActor,
  TimelineVisibility,
  TransactionStatus,
  OrderStatus,
  PaymentStatus,
  PaymentProvider,
  RefundType,
  RefundStatus,
  LedgerEntryType,
  Prisma,
} from "@prisma/client";
import { logger } from "./logger";
import { toMinorUnits, minorUnitsToMajorString } from "./money";
import { appendBalancedLedgerPair } from "./ledger";

export interface CreateDisputeCaseInput {
  transactionId: string;
  businessId: string;
  orderId?: string | null;
  category?: DisputeCategory;
  reason: string;
  buyerNotes?: string | null;
  claimantType?: "BUYER" | "SELLER";
  claimantId?: string | null;
  refundAmount?: number | null;
  evidenceUrls?: string[];
  initialEvidenceNotes?: string | null;
  mediaUrl?: string | null;
}

export interface SubmitDisputeEvidenceInput {
  evidenceType: EvidenceType;
  source: string;
  actor: TimelineActor;
  mediaUrl?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResolveDisputeCaseInput {
  resolution: "APPROVED" | "REJECTED" | "RESOLVED" | "REFUNDED" | "CLOSED";
  resolutionReason: string;
  refundAmount?: number | null;
  notes?: string | null;
}

/**
 * Computes deterministic SHA-256 hash for evidence integrity validation.
 */
export function computeEvidenceHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Evaluates available evidence and produces a deterministic recommendation.
 */
export function evaluateDisputeRecommendation(
  evidenceList: Array<{ evidenceType: EvidenceType; actor: TimelineActor }>
): DisputeDecisionRecommendation {
  if (evidenceList.length === 0) {
    return DisputeDecisionRecommendation.INSUFFICIENT_EVIDENCE;
  }

  const hasBuyerEvidence = evidenceList.some((e) => e.actor === TimelineActor.BUYER);
  const hasSellerOrCarrierEvidence = evidenceList.some(
    (e) => e.actor === TimelineActor.SELLER || e.actor === TimelineActor.CARRIER || e.actor === TimelineActor.SYSTEM
  );

  if (!hasBuyerEvidence) {
    return DisputeDecisionRecommendation.BUYER_EVIDENCE_REQUIRED;
  }

  if (!hasSellerOrCarrierEvidence) {
    return DisputeDecisionRecommendation.SELLER_EVIDENCE_REQUIRED;
  }

  return DisputeDecisionRecommendation.READY_FOR_REVIEW;
}

/**
 * Creates a structured dispute case with provenance and timeline integration.
 */
export async function createDisputeCase(
  input: CreateDisputeCaseInput,
  actorUserId?: string
) {
  const transaction = await prisma.socialTransaction.findUnique({
    where: { id: input.transactionId },
    include: { order: true, business: true },
  });

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  if (transaction.businessId !== input.businessId) {
    throw new Error("Transaction does not belong to specified business tenant");
  }

  const category = input.category ?? DisputeCategory.OTHER;

  return prisma.$transaction(async (tx) => {
    // 1. Create the dispute record
    const dispute = await tx.transactionDispute.create({
      data: {
        transactionId: transaction.id,
        businessId: transaction.businessId,
        orderId: transaction.orderId ?? input.orderId ?? null,
        category,
        reason: input.reason.trim(),
        status: DisputeStatus.OPEN,
        claimantType: input.claimantType ?? "BUYER",
        claimantId: input.claimantId ?? transaction.buyerIdentityId ?? null,
        refundAmount:
          input.refundAmount !== undefined && input.refundAmount !== null
            ? new Prisma.Decimal(input.refundAmount)
            : null,
        buyerNotes: input.buyerNotes ?? null,
        evidenceUrls: input.evidenceUrls ?? [],
        decisionRecommendation: DisputeDecisionRecommendation.INSUFFICIENT_EVIDENCE,
      },
    });

    // 2. Attach initial evidence if mediaUrl or initial evidence notes provided
    if (input.mediaUrl || input.initialEvidenceNotes || (input.evidenceUrls && input.evidenceUrls.length > 0)) {
      const primaryUrl = input.mediaUrl || (input.evidenceUrls ? input.evidenceUrls[0] : null);
      const content = `${primaryUrl ?? ""}|${input.initialEvidenceNotes ?? input.reason}`;
      const contentHash = computeEvidenceHash(content);

      await tx.transactionEvidence.create({
        data: {
          transactionId: transaction.id,
          disputeId: dispute.id,
          evidenceType: EvidenceType.DISPUTE_EVIDENCE,
          verificationState: EvidenceVerificationState.USER_PROVIDED,
          source: input.claimantType === "SELLER" ? "SELLER_PORTAL" : "BUYER_PORTAL",
          actor: input.claimantType === "SELLER" ? TimelineActor.SELLER : TimelineActor.BUYER,
          mediaUrl: primaryUrl,
          notes: input.initialEvidenceNotes ?? `Initial dispute claim: ${input.reason}`,
          contentHash,
        },
      });
    }

    // 3. Append public timeline event
    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: transaction.id,
        eventType: "DISPUTE_RAISED",
        title: `Dispute Case Opened: ${category.replace(/_/g, " ")}`,
        description: `Reason: ${input.reason}`,
        actor: input.claimantType === "SELLER" ? TimelineActor.SELLER : TimelineActor.BUYER,
        visibility: TimelineVisibility.PUBLIC,
        metadata: {
          disputeId: dispute.id,
          category,
          refundAmount: input.refundAmount,
        },
      },
    });

    // 4. Update transaction status to DISPUTED
    await tx.socialTransaction.update({
      where: { id: transaction.id },
      data: { status: TransactionStatus.DISPUTED },
    });

    // 5. Audit event
    await tx.trustRiskAuditEvent.create({
      data: {
        businessId: transaction.businessId,
        buyerIdentityId: transaction.buyerIdentityId,
        transactionId: transaction.id,
        disputeId: dispute.id,
        eventType: "DISPUTE_CREATED",
        actorType: input.claimantType ?? "BUYER",
        actorId: actorUserId ?? null,
        newState: {
          disputeId: dispute.id,
          category,
          status: DisputeStatus.OPEN,
          reason: input.reason,
        },
        reason: `Dispute case created with category ${category}`,
      },
    });

    return dispute;
  });
}

/**
 * Requests evidence from the buyer or seller.
 */
export async function requestDisputeEvidence(
  disputeId: string,
  businessId: string,
  requestedFrom: "BUYER" | "SELLER",
  notes: string,
  actorUserId?: string
) {
  const dispute = await prisma.transactionDispute.findFirst({
    where: { id: disputeId, businessId },
    include: { transaction: true },
  });

  if (!dispute) {
    throw new Error("Dispute not found or access denied");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.transactionDispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.EVIDENCE_REQUESTED,
        evidenceRequestedAt: new Date(),
        resolutionNotes: notes ? `Evidence requested from ${requestedFrom}: ${notes}` : undefined,
      },
    });

    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: dispute.transactionId,
        eventType: "DISPUTE_EVIDENCE_REQUESTED",
        title: `Evidence Requested from ${requestedFrom}`,
        description: notes,
        actor: TimelineActor.SYSTEM,
        visibility: TimelineVisibility.PUBLIC,
        metadata: { disputeId, requestedFrom },
      },
    });

    await tx.trustRiskAuditEvent.create({
      data: {
        businessId,
        transactionId: dispute.transactionId,
        disputeId,
        eventType: "DISPUTE_EVIDENCE_REQUESTED",
        actorType: "USER",
        actorId: actorUserId ?? null,
        previousState: { status: dispute.status },
        newState: { status: DisputeStatus.EVIDENCE_REQUESTED, requestedFrom },
        reason: notes,
      },
    });

    return res;
  });

  logger.info("dispute.evidence_requested", { disputeId, requestedFrom });
  return updated;
}

/**
 * Submits evidence to a dispute case with SHA-256 tamper-evident integrity hash.
 */
export async function submitDisputeEvidence(
  disputeId: string,
  input: SubmitDisputeEvidenceInput,
  actorUserId?: string
) {
  const dispute = await prisma.transactionDispute.findUnique({
    where: { id: disputeId },
    include: { evidenceRecords: true },
  });

  if (!dispute) {
    throw new Error("Dispute not found");
  }

  const content = `${input.mediaUrl ?? ""}|${input.notes ?? ""}|${input.evidenceType}`;
  const contentHash = computeEvidenceHash(content);

  return prisma.$transaction(async (tx) => {
    // 1. Create evidence record
    const evidence = await tx.transactionEvidence.create({
      data: {
        transactionId: dispute.transactionId,
        disputeId: dispute.id,
        evidenceType: input.evidenceType,
        verificationState:
          input.actor === TimelineActor.BUYER
            ? EvidenceVerificationState.USER_PROVIDED
            : input.actor === TimelineActor.SELLER
            ? EvidenceVerificationState.SELLER_CONFIRMED
            : EvidenceVerificationState.SYSTEM_GENERATED,
        source: input.source,
        actor: input.actor,
        mediaUrl: input.mediaUrl ?? null,
        notes: input.notes ?? null,
        contentHash,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    // 2. Re-evaluate recommendation
    const allEvidence = [...dispute.evidenceRecords, evidence];
    const recommendation = evaluateDisputeRecommendation(allEvidence);

    // 3. Transition status to EVIDENCE_SUBMITTED
    const updatedDispute = await tx.transactionDispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.EVIDENCE_SUBMITTED,
        decisionRecommendation: recommendation,
      },
    });

    // 4. Timeline event
    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: dispute.transactionId,
        eventType: "DISPUTE_EVIDENCE_SUBMITTED",
        title: `Evidence Submitted by ${input.actor}`,
        description: input.notes ?? `Attached ${input.evidenceType.replace(/_/g, " ").toLowerCase()}`,
        actor: input.actor,
        visibility: TimelineVisibility.PUBLIC,
        metadata: {
          disputeId,
          evidenceId: evidence.id,
          evidenceType: input.evidenceType,
          contentHash,
        },
      },
    });

    // 5. Audit event
    await tx.trustRiskAuditEvent.create({
      data: {
        businessId: dispute.businessId,
        transactionId: dispute.transactionId,
        disputeId,
        eventType: "DISPUTE_EVIDENCE_SUBMITTED",
        actorType: input.actor.toString(),
        actorId: actorUserId ?? null,
        newState: {
          evidenceId: evidence.id,
          evidenceType: input.evidenceType,
          contentHash,
          status: DisputeStatus.EVIDENCE_SUBMITTED,
          recommendation,
        },
        reason: input.notes,
      },
    });

    return { evidence, dispute: updatedDispute };
  });
}

/**
 * Reviews a dispute case, transitioning it to UNDER_REVIEW with updated recommendations.
 */
export async function reviewDisputeCase(
  disputeId: string,
  businessId: string,
  reviewerUserId: string,
  notes?: string
) {
  const dispute = await prisma.transactionDispute.findFirst({
    where: { id: disputeId, businessId },
    include: { evidenceRecords: true },
  });

  if (!dispute) {
    throw new Error("Dispute not found or access denied");
  }

  const recommendation = evaluateDisputeRecommendation(dispute.evidenceRecords);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.transactionDispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.UNDER_REVIEW,
        decisionRecommendation: recommendation,
        resolutionNotes: notes
          ? `${dispute.resolutionNotes ? dispute.resolutionNotes + "\n" : ""}[Review]: ${notes}`
          : dispute.resolutionNotes,
      },
    });

    await tx.trustRiskAuditEvent.create({
      data: {
        businessId,
        transactionId: dispute.transactionId,
        disputeId,
        eventType: "DISPUTE_REVIEW_STARTED",
        actorType: "USER",
        actorId: reviewerUserId,
        previousState: { status: dispute.status },
        newState: {
          status: DisputeStatus.UNDER_REVIEW,
          recommendation,
        },
        reason: notes ?? "Dispute placed under formal review",
      },
    });

    return updated;
  });
}

/**
 * Resolves a dispute case with structured decisions, optional refund processing,
 * and immutable timeline records.
 */
export async function resolveDisputeCase(
  disputeId: string,
  businessId: string,
  input: ResolveDisputeCaseInput,
  actorUserId: string
) {
  const dispute = await prisma.transactionDispute.findFirst({
    where: { id: disputeId, businessId },
    include: { transaction: true, order: true },
  });

  if (!dispute) {
    throw new Error("Dispute not found or access denied");
  }

  const finalStatus: DisputeStatus =
    input.resolution === "APPROVED"
      ? DisputeStatus.APPROVED
      : input.resolution === "REJECTED"
      ? DisputeStatus.REJECTED
      : input.resolution === "REFUNDED"
      ? DisputeStatus.REFUNDED
      : input.resolution === "CLOSED"
      ? DisputeStatus.CLOSED
      : DisputeStatus.RESOLVED;

  return prisma.$transaction(async (tx) => {
    // 1. Update dispute
    const updatedDispute = await tx.transactionDispute.update({
      where: { id: disputeId },
      data: {
        status: finalStatus,
        resolutionReason: input.resolutionReason,
        resolutionNotes: input.notes
          ? `${dispute.resolutionNotes ? dispute.resolutionNotes + "\n" : ""}[Resolved]: ${input.notes}`
          : dispute.resolutionNotes,
        resolvedByUserId: actorUserId,
        resolvedAt: new Date(),
        refundAmount:
          input.refundAmount !== undefined && input.refundAmount !== null
            ? new Prisma.Decimal(input.refundAmount)
            : dispute.refundAmount,
      },
    });

    // 2. If approved/refunded, transition order payment status & record canonical Refund/Ledger if captured > 0
    if ((finalStatus === DisputeStatus.APPROVED || finalStatus === DisputeStatus.REFUNDED) && dispute.orderId) {
      const orderRec = dispute.order;
      const paidMinor = orderRec ? toMinorUnits(orderRec.amountPaid, orderRec.currency) : 0;
      const requestedRefundVal =
        input.refundAmount ?? (dispute.refundAmount ? Number(dispute.refundAmount) : 0);
      const requestedMinor =
        orderRec && requestedRefundVal > 0
          ? toMinorUnits(requestedRefundVal, orderRec.currency)
          : paidMinor;

      const existingRefunds = await tx.refund.aggregate({
        where: {
          businessId,
          orderId: dispute.orderId,
          status: { in: [RefundStatus.REQUESTED, RefundStatus.PROCESSING, RefundStatus.COMPLETED] },
        },
        _sum: { amountMinorUnits: true },
      });
      const alreadyRefundedMinor = existingRefunds._sum.amountMinorUnits || 0;
      const refundableMinor = Math.max(0, paidMinor - alreadyRefundedMinor);
      const actualRefundMinor = Math.min(requestedMinor, refundableMinor);

      if (orderRec && actualRefundMinor > 0) {
        const refund = await tx.refund.create({
          data: {
            businessId,
            orderId: dispute.orderId,
            socialTransactionId: dispute.transactionId,
            disputeId: dispute.id,
            type: RefundType.DISPUTE_REFUND,
            status: RefundStatus.COMPLETED,
            amountMinorUnits: actualRefundMinor,
            currency: orderRec.currency,
            reason: `Dispute resolution: ${input.resolutionReason}`,
            provider: PaymentProvider.MANUAL,
            providerRefundId: `disp_ref_${dispute.id.slice(0, 12)}`,
            idempotencyKey: `dispute-refund:${dispute.id}`,
            requestedByUserId: actorUserId,
            processedAt: new Date(),
          },
        });

        await appendBalancedLedgerPair(
          {
            businessId,
            orderId: dispute.orderId,
            socialTransactionId: dispute.transactionId,
            refundId: refund.id,
            entryType: LedgerEntryType.REFUND_COMPLETED,
            debitAccount: "ORDER_RECEIVABLE",
            creditAccount: "PROVIDER_CLEARING",
            amountMinorUnits: actualRefundMinor,
            currency: orderRec.currency,
            referenceType: "DISPUTE_RESOLUTION",
            referenceId: dispute.id,
            provider: PaymentProvider.MANUAL,
            idempotencyKeyPrefix: `dispute-refund:${dispute.id}`,
            description: `Dispute refund (${minorUnitsToMajorString(actualRefundMinor, orderRec.currency)} ${orderRec.currency}): ${input.resolutionReason}`,
          },
          tx
        );

        await tx.order.update({
          where: { id: dispute.orderId },
          data: {
            paymentStatus:
              alreadyRefundedMinor + actualRefundMinor >= paidMinor
                ? PaymentStatus.REFUNDED
                : orderRec.paymentStatus,
            refundedAmountMinorUnits: alreadyRefundedMinor + actualRefundMinor,
            status: OrderStatus.CANCELLED,
          },
        });
      } else {
        await tx.order.update({
          where: { id: dispute.orderId },
          data: {
            paymentStatus: PaymentStatus.REFUNDED,
            status: OrderStatus.CANCELLED,
          },
        });
      }

      // Record refund evidence
      await tx.transactionEvidence.create({
        data: {
          transactionId: dispute.transactionId,
          disputeId: dispute.id,
          evidenceType: EvidenceType.REFUND_RECORD,
          verificationState: EvidenceVerificationState.SELLER_CONFIRMED,
          source: "DISPUTE_RESOLUTION",
          actor: TimelineActor.SELLER,
          notes: `Refund processed: ${input.resolutionReason}`,
        },
      });
    }

    // 3. Update SocialTransaction status
    const newTxStatus =
      finalStatus === DisputeStatus.APPROVED || finalStatus === DisputeStatus.REFUNDED
        ? TransactionStatus.REFUNDED
        : TransactionStatus.COMPLETED;

    await tx.socialTransaction.update({
      where: { id: dispute.transactionId },
      data: { status: newTxStatus },
    });

    // 4. Record Timeline Event
    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: dispute.transactionId,
        eventType: "DISPUTE_RESOLVED",
        title: `Dispute Case Resolved: ${input.resolution}`,
        description: input.resolutionReason,
        actor: TimelineActor.SELLER,
        visibility: TimelineVisibility.PUBLIC,
        metadata: {
          disputeId,
          resolution: input.resolution,
          refundAmount: input.refundAmount,
        },
      },
    });

    // 5. Record Audit Event
    await tx.trustRiskAuditEvent.create({
      data: {
        businessId,
        transactionId: dispute.transactionId,
        disputeId,
        eventType: "DISPUTE_RESOLVED",
        actorType: "USER",
        actorId: actorUserId,
        previousState: { status: dispute.status },
        newState: {
          status: finalStatus,
          resolution: input.resolution,
          refundAmount: input.refundAmount,
        },
        reason: input.resolutionReason,
      },
    });

    return updatedDispute;
  });
}

/**
 * Escalates a dispute for third-party or platform arbitration.
 */
export async function escalateDisputeCase(
  disputeId: string,
  businessId: string,
  reason: string,
  actorUserId?: string
) {
  const dispute = await prisma.transactionDispute.findFirst({
    where: { id: disputeId, businessId },
  });

  if (!dispute) {
    throw new Error("Dispute not found or access denied");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.transactionDispute.update({
      where: { id: disputeId },
      data: {
        status: DisputeStatus.ESCALATED,
        escalatedAt: new Date(),
        resolutionNotes: `${dispute.resolutionNotes ? dispute.resolutionNotes + "\n" : ""}[Escalated]: ${reason}`,
      },
    });

    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: dispute.transactionId,
        eventType: "DISPUTE_ESCALATED",
        title: "Dispute Escalated for Platform Review",
        description: reason,
        actor: TimelineActor.SYSTEM,
        visibility: TimelineVisibility.PUBLIC,
        metadata: { disputeId, reason },
      },
    });

    await tx.trustRiskAuditEvent.create({
      data: {
        businessId,
        transactionId: dispute.transactionId,
        disputeId,
        eventType: "DISPUTE_ESCALATED",
        actorType: "USER",
        actorId: actorUserId ?? null,
        previousState: { status: dispute.status },
        newState: { status: DisputeStatus.ESCALATED },
        reason,
      },
    });

    return updated;
  });
}

/**
 * Retrieves a single dispute by ID scoped to the caller tenant.
 */
export async function getDisputeById(disputeId: string, businessId?: string) {
  const where: Prisma.TransactionDisputeWhereInput = { id: disputeId };
  if (businessId) where.businessId = businessId;

  return prisma.transactionDispute.findFirst({
    where,
    include: {
      transaction: {
        include: {
          order: true,
          customer: true,
          buyerIdentity: {
            select: { id: true, userId: true, displayName: true, verificationLevel: true },
          },
        },
      },
      evidenceRecords: {
        orderBy: { createdAt: "desc" },
      },
      trustSignals: {
        orderBy: { observedAt: "desc" },
      },
    },
  });
}

/**
 * Retrieves disputes for a business tenant with filters and pagination.
 */
export async function getBusinessDisputes(
  businessId: string,
  filter?: {
    status?: DisputeStatus;
    category?: DisputeCategory;
    take?: number;
    skip?: number;
  }
) {
  const where: Prisma.TransactionDisputeWhereInput = { businessId };
  if (filter?.status) where.status = filter.status;
  if (filter?.category) where.category = filter.category;

  const [items, total] = await Promise.all([
    prisma.transactionDispute.findMany({
      where,
      include: {
        transaction: {
          select: {
            id: true,
            platform: true,
            publicTrackingToken: true,
            status: true,
            order: {
              select: {
                orderNumber: true,
                totalAmount: true,
                currency: true,
              },
            },
          },
        },
        evidenceRecords: {
          select: { id: true, evidenceType: true, actor: true, createdAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: filter?.take ? Math.min(100, filter.take) : 25,
      skip: filter?.skip ?? 0,
    }),
    prisma.transactionDispute.count({ where }),
  ]);

  return { items, total };
}
