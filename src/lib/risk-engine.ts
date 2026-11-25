import { prisma } from "./prisma";
import {
  TransactionRiskLevel,
  RiskReviewStatus,
  OrderStatus,
  PaymentStatus,
  TransactionStatus,
  IdentityConfidence,
  Prisma,
} from "@prisma/client";
import { logger } from "./logger";

export interface RiskReason {
  code: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  explanation: string;
  source: "IDENTITY" | "PAYMENT" | "SELLER" | "FULFILLMENT" | "DISPUTE" | "TRANSACTION";
}

export interface TransactionRiskResult {
  assessmentId: string;
  transactionId: string;
  businessId: string;
  buyerIdentityId: string | null;
  riskLevel: TransactionRiskLevel;
  score: number;
  reasons: RiskReason[];
  modelVersion: string;
  assessedAt: string;
  reviewRequired: boolean;
  activeReviewId?: string;
}

/**
 * Deterministically evaluates a transaction's risk profile based on observable signals,
 * evidence completeness, payment status, and historical patterns.
 */
export async function assessTransactionRisk(
  transactionId: string,
  options?: { forceReassessment?: boolean; actorId?: string }
): Promise<TransactionRiskResult> {
  const transaction = await prisma.socialTransaction.findUnique({
    where: { id: transactionId },
    include: {
      order: {
        include: {
          payments: { orderBy: { createdAt: "desc" }, take: 3 },
          shipments: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
      buyerIdentity: {
        include: {
          links: true,
        },
      },
      business: {
        select: {
          id: true,
          name: true,
        },
      },
      evidence: true,
      disputes: true,
      riskAssessment: {
        include: {
          reviews: {
            where: { status: { in: [RiskReviewStatus.OPEN, RiskReviewStatus.IN_PROGRESS] } },
            take: 1,
          },
        },
      },
    },
  });

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const reasons: RiskReason[] = [];
  let riskScore = 10; // Baseline healthy score (0 to 100)

  // 1. Identity Signals
  if (!transaction.buyerIdentityId) {
    reasons.push({
      code: "GUEST_TRANSACTION",
      severity: "LOW",
      explanation: "Transaction was conducted as a guest without an authenticated OrderFlow buyer identity.",
      source: "IDENTITY",
    });
    riskScore += 15;
  } else if (transaction.buyerIdentity) {
    if (transaction.buyerIdentity.verificationLevel === IdentityConfidence.UNVERIFIED) {
      reasons.push({
        code: "UNVERIFIED_BUYER_IDENTITY",
        severity: "LOW",
        explanation: "Buyer identity does not yet possess verified contact credentials.",
        source: "IDENTITY",
      });
      riskScore += 10;
    } else if (transaction.buyerIdentity.verificationLevel === IdentityConfidence.STRONGLY_VERIFIED) {
      reasons.push({
        code: "STRONGLY_VERIFIED_BUYER",
        severity: "INFO",
        explanation: "Buyer holds strongly verified OrderFlow account credentials.",
        source: "IDENTITY",
      });
      riskScore -= 5;
    }
  }

  // 2. Payment Signals
  if (transaction.order) {
    const order = transaction.order;
    const totalAmount = Number(order.totalAmount);

    if (order.paymentStatus === PaymentStatus.PENDING) {
      reasons.push({
        code: "PAYMENT_PENDING",
        severity: "MEDIUM",
        explanation: "Payment has not yet been received or verified for this order.",
        source: "PAYMENT",
      });
      riskScore += 25;
    }

    const hasRejectedPayment = order.payments?.some((p) => (p.status as string) === "REJECTED");
    if (hasRejectedPayment) {
      reasons.push({
        code: "PAYMENT_FAILED",
        severity: "HIGH",
        explanation: "A recent payment attempt for this order failed or was rejected.",
        source: "PAYMENT",
      });
      riskScore += 40;
    }

    // High transaction value anomaly threshold
    if (totalAmount >= 500 && !transaction.buyerIdentity?.emailVerifiedAt) {
      reasons.push({
        code: "HIGH_VALUE_UNVERIFIED_BUYER",
        severity: "HIGH",
        explanation: `Transaction total (${order.currency} ${totalAmount}) exceeds threshold without verified buyer contact credentials.`,
        source: "TRANSACTION",
      });
      riskScore += 30;
    }
  }

  // 3. Dispute Signals
  if (transaction.disputes.length > 0) {
    const openDispute = transaction.disputes.find((d) =>
      ["REQUESTED", "OPEN", "UNDER_REVIEW", "EVIDENCE_REQUESTED", "EVIDENCE_SUBMITTED"].includes(
        d.status
      )
    );
    if (openDispute) {
      reasons.push({
        code: "ACTIVE_DISPUTE_OPEN",
        severity: "HIGH",
        explanation: `An unresolved dispute (${openDispute.reason}) is active on this transaction.`,
        source: "DISPUTE",
      });
      riskScore += 35;
    }
  }

  // 4. Evidence Signals
  if (
    transaction.status === TransactionStatus.DELIVERED &&
    !transaction.evidence.some(
      (e) =>
        e.evidenceType === "DELIVERY_CONFIRMATION" ||
        e.evidenceType === "BUYER_CONFIRMATION"
    )
  ) {
    reasons.push({
      code: "DELIVERED_WITHOUT_DELIVERY_EVIDENCE",
      severity: "MEDIUM",
      explanation: "Transaction marked delivered without attached carrier tracking or buyer confirmation evidence.",
      source: "FULFILLMENT",
    });
    riskScore += 20;
  }

  // Bound score between 0 and 100
  const normalizedScore = Math.max(0, Math.min(100, riskScore));

  // Determine categorical risk level
  let riskLevel: TransactionRiskLevel = TransactionRiskLevel.LOW;
  if (
    normalizedScore >= 65 ||
    reasons.some((r) => r.severity === "CRITICAL" || r.severity === "HIGH")
  ) {
    riskLevel =
      reasons.some((r) => r.severity === "HIGH" || r.severity === "CRITICAL")
        ? TransactionRiskLevel.REVIEW_REQUIRED
        : TransactionRiskLevel.HIGH;
  } else if (normalizedScore >= 35) {
    riskLevel = TransactionRiskLevel.MEDIUM;
  }

  const modelVersion = "v1";
  const now = new Date();

  // Persist assessment via atomic upsert
  const assessment = await prisma.transactionRiskAssessment.upsert({
    where: { socialTransactionId: transaction.id },
    create: {
      socialTransactionId: transaction.id,
      businessId: transaction.businessId,
      buyerIdentityId: transaction.buyerIdentityId ?? null,
      riskLevel,
      score: normalizedScore,
      reasons: reasons as unknown as Prisma.InputJsonValue,
      modelVersion,
      assessedAt: now,
    },
    update: {
      riskLevel,
      score: normalizedScore,
      reasons: reasons as unknown as Prisma.InputJsonValue,
      modelVersion,
      assessedAt: now,
    },
  });

  // If review is required, ensure an open RiskReview item exists
  let reviewId: string | undefined;
  if (
    riskLevel === TransactionRiskLevel.REVIEW_REQUIRED ||
    riskLevel === TransactionRiskLevel.HIGH
  ) {
    const existingReview = await prisma.riskReview.findFirst({
      where: {
        assessmentId: assessment.id,
        status: { in: [RiskReviewStatus.OPEN, RiskReviewStatus.IN_PROGRESS] },
      },
    });

    if (!existingReview) {
      const highestReason =
        reasons.find((r) => r.severity === "HIGH" || r.severity === "CRITICAL")
          ?.explanation ?? "Elevated risk score observed during automated assessment.";

      const newReview = await prisma.riskReview.create({
        data: {
          assessmentId: assessment.id,
          businessId: transaction.businessId,
          status: RiskReviewStatus.OPEN,
          reason: highestReason,
        },
      });
      reviewId = newReview.id;
    } else {
      reviewId = existingReview.id;
    }
  }

  // Audit event
  await prisma.trustRiskAuditEvent.create({
    data: {
      businessId: transaction.businessId,
      buyerIdentityId: transaction.buyerIdentityId ?? null,
      transactionId: transaction.id,
      assessmentId: assessment.id,
      eventType: "ASSESSMENT_EVALUATED",
      actorType: options?.actorId ? "USER" : "SYSTEM",
      actorId: options?.actorId ?? null,
      newState: {
        riskLevel,
        score: normalizedScore,
        reasonsCount: reasons.length,
      },
      reason: `Automated risk assessment evaluated with level ${riskLevel}`,
    },
  });

  logger.info("risk_engine.assessed", {
    transactionId: transaction.id,
    businessId: transaction.businessId,
    riskLevel,
    score: normalizedScore,
  });

  return {
    assessmentId: assessment.id,
    transactionId: transaction.id,
    businessId: transaction.businessId,
    buyerIdentityId: transaction.buyerIdentityId ?? null,
    riskLevel,
    score: normalizedScore,
    reasons,
    modelVersion,
    assessedAt: now.toISOString(),
    reviewRequired:
      riskLevel === TransactionRiskLevel.REVIEW_REQUIRED ||
      riskLevel === TransactionRiskLevel.HIGH,
    activeReviewId: reviewId,
  };
}

/**
 * Assigns an open risk review to a seller team member.
 */
export async function assignRiskReview(
  businessId: string,
  reviewId: string,
  assignedUserId: string,
  notes?: string
) {
  const review = await prisma.riskReview.findFirst({
    where: { id: reviewId, businessId },
    include: { assessment: true },
  });

  if (!review) {
    throw new Error("Risk review not found or tenant access denied");
  }

  const updated = await prisma.riskReview.update({
    where: { id: reviewId },
    data: {
      assignedToUserId: assignedUserId,
      status: RiskReviewStatus.IN_PROGRESS,
      notes: notes ? `${review.notes ? review.notes + "\n" : ""}${notes}` : review.notes,
    },
  });

  await prisma.trustRiskAuditEvent.create({
    data: {
      businessId,
      assessmentId: review.assessmentId,
      eventType: "REVIEW_ASSIGNED",
      actorType: "USER",
      actorId: assignedUserId,
      previousState: { status: review.status, assignedTo: review.assignedToUserId },
      newState: { status: updated.status, assignedTo: assignedUserId },
      reason: "Manual review assigned to team member",
    },
  });

  return updated;
}

/**
 * Resolves a manual risk review with an explicit decision (APPROVED, REJECTED, ESCALATED, DISMISSED).
 */
export async function resolveRiskReview(
  businessId: string,
  reviewId: string,
  decision: "APPROVED" | "REJECTED" | "ESCALATED" | "DISMISSED",
  notes: string,
  actorUserId: string
) {
  if (!decision || !notes) {
    throw new Error("Decision and explanation notes are required to resolve a risk review");
  }

  const review = await prisma.riskReview.findFirst({
    where: { id: reviewId, businessId },
    include: { assessment: true },
  });

  if (!review) {
    throw new Error("Risk review not found or tenant access denied");
  }

  const newStatus =
    decision === "ESCALATED"
      ? RiskReviewStatus.ESCALATED
      : decision === "DISMISSED"
      ? RiskReviewStatus.DISMISSED
      : RiskReviewStatus.RESOLVED;

  return prisma.$transaction(async (tx) => {
    const updatedReview = await tx.riskReview.update({
      where: { id: reviewId },
      data: {
        status: newStatus,
        decision,
        notes: `${review.notes ? review.notes + "\n" : ""}[${decision} by ${actorUserId}]: ${notes}`,
        reviewedAt: new Date(),
      },
    });

    // If approved, downgrade risk level to LOW
    if (decision === "APPROVED") {
      await tx.transactionRiskAssessment.update({
        where: { id: review.assessmentId },
        data: {
          riskLevel: TransactionRiskLevel.LOW,
        },
      });
    }

    await tx.trustRiskAuditEvent.create({
      data: {
        businessId,
        assessmentId: review.assessmentId,
        eventType: "REVIEW_RESOLVED",
        actorType: "USER",
        actorId: actorUserId,
        previousState: { status: review.status },
        newState: { status: newStatus, decision },
        reason: notes,
      },
    });

    return updatedReview;
  });
}

/**
 * Retrieves risk assessments for a business tenant with pagination and filters.
 */
export async function getBusinessRiskAssessments(
  businessId: string,
  filter?: {
    riskLevel?: TransactionRiskLevel;
    take?: number;
    skip?: number;
  }
) {
  const where: Prisma.TransactionRiskAssessmentWhereInput = { businessId };
  if (filter?.riskLevel) where.riskLevel = filter.riskLevel;

  const [items, total] = await Promise.all([
    prisma.transactionRiskAssessment.findMany({
      where,
      include: {
        socialTransaction: {
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
                paymentStatus: true,
              },
            },
          },
        },
        reviews: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { assessedAt: "desc" },
      take: filter?.take ? Math.min(100, filter.take) : 25,
      skip: filter?.skip ?? 0,
    }),
    prisma.transactionRiskAssessment.count({ where }),
  ]);

  return { items, total };
}

/**
 * Retrieves manual risk reviews for a business tenant.
 */
export async function getBusinessRiskReviews(
  businessId: string,
  filter?: {
    status?: RiskReviewStatus;
    take?: number;
    skip?: number;
  }
) {
  const where: Prisma.RiskReviewWhereInput = { businessId };
  if (filter?.status) where.status = filter.status;

  const [items, total] = await Promise.all([
    prisma.riskReview.findMany({
      where,
      include: {
        assessment: {
          include: {
            socialTransaction: {
              select: {
                id: true,
                platform: true,
                publicTrackingToken: true,
                order: {
                  select: {
                    orderNumber: true,
                    totalAmount: true,
                    currency: true,
                  },
                },
              },
            },
          },
        },
        assignedToUser: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: filter?.take ? Math.min(100, filter.take) : 25,
      skip: filter?.skip ?? 0,
    }),
    prisma.riskReview.count({ where }),
  ]);

  return { items, total };
}
