import {
  OrderStatus,
  Prisma,
  ReviewDisplayMode,
  ReviewModerationState,
  TransactionStatus,
} from "@prisma/client";
import { prisma } from "./prisma";
import { getOrCreateBuyerIdentity } from "./buyer-identity";
import { computeAndPersistSellerReputation } from "./reputation";
import { syncProductDiscoveryIndex } from "./marketplace";
import { flagPlatformAbuse } from "./platform-abuse";
import {
  ForbiddenError,
  NotFoundError,
  ReviewEligibilityError,
  ValidationError,
} from "./errors";

const DEFAULT_EDIT_WINDOW_DAYS = 7;

export function formatBuyerReviewDisplayName(
  displayName: string | null | undefined,
  mode: ReviewDisplayMode
): string {
  if (mode === ReviewDisplayMode.ANONYMOUS) {
    return "Anonymous";
  }
  if (mode === ReviewDisplayMode.NAME_INITIAL && displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
    }
    return parts[0].slice(0, 24);
  }
  return "Verified Buyer";
}

/**
 * Verifies buyer ownership and eligible completed transaction state before accepting a review.
 * Disputes NEVER auto-convert into reviews — disputes and reviews remain strictly separated.
 */
export async function verifyReviewEligibility(params: {
  buyerIdentityId: string;
  userId: string;
  orderId: string;
  productId?: string | null;
}) {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: {
      socialTransaction: true,
      items: true,
      shipments: true,
    },
  });

  if (!order || !order.socialTransaction) {
    throw new ReviewEligibilityError("Order or associated transaction not found");
  }

  const tx = order.socialTransaction;
  const ownsTransaction =
    tx.buyerIdentityId === params.buyerIdentityId || tx.buyerUserId === params.userId;

  if (!ownsTransaction) {
    throw new ReviewEligibilityError(
      "You can only review transactions belonging to your OrderFlow buyer identity"
    );
  }

  const isCompletedOrder =
    order.status === OrderStatus.DELIVERED ||
    tx.status === TransactionStatus.COMPLETED ||
    tx.status === TransactionStatus.DELIVERED ||
    order.shipments.some((s) => s.status === "DELIVERED");

  if (!isCompletedOrder) {
    throw new ReviewEligibilityError(
      "Reviews are enabled only after order delivery or transaction completion"
    );
  }

  if (params.productId) {
    const hasProductInOrder = order.items.some((i) => i.productId === params.productId);
    if (!hasProductInOrder) {
      throw new ReviewEligibilityError(
        "The specified product was not purchased in this order"
      );
    }
  }

  const reviewScopeKey = `${order.id}:${params.productId || "SELLER"}`;
  const existing = await prisma.review.findUnique({
    where: {
      buyerIdentityId_reviewScopeKey: {
        buyerIdentityId: params.buyerIdentityId,
        reviewScopeKey,
      },
    },
  });

  if (existing) {
    throw new ReviewEligibilityError(
      "A review has already been submitted for this transaction item"
    );
  }

  return { order, transaction: tx, reviewScopeKey };
}

export async function createTransactionReview(
  userId: string,
  input: {
    orderId: string;
    productId?: string | null;
    rating: number;
    title?: string | null;
    comment?: string | null;
    displayMode?: ReviewDisplayMode;
  }
) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new ValidationError("Rating must be an integer between 1 and 5");
  }

  const identity = await getOrCreateBuyerIdentity(userId);
  const { order, transaction, reviewScopeKey } = await verifyReviewEligibility({
    buyerIdentityId: identity.id,
    userId,
    orderId: input.orderId,
    productId: input.productId,
  });

  const mode = input.displayMode ?? identity.reviewDisplayMode ?? ReviewDisplayMode.VERIFIED_BUYER;
  const authorDisplayName = formatBuyerReviewDisplayName(identity.displayName, mode);
  const editableUntil = new Date(Date.now() + DEFAULT_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const review = await prisma.review.create({
    data: {
      businessId: order.businessId,
      orderId: order.id,
      socialTransactionId: transaction.id,
      buyerIdentityId: identity.id,
      productId: input.productId ?? null,
      reviewScopeKey,
      rating: input.rating,
      title: input.title?.trim() || null,
      comment: input.comment?.trim() || null,
      authorDisplayMode: mode,
      authorDisplayName,
      moderationState: ReviewModerationState.PUBLISHED,
      editableUntil,
      editHistory: [],
    },
  });

  await computeAndPersistSellerReputation(order.businessId);
  if (input.productId) {
    await syncProductDiscoveryIndex(input.productId);
  }

  return review;
}

export async function updateBuyerReview(
  userId: string,
  reviewId: string,
  input: {
    rating?: number;
    title?: string | null;
    comment?: string | null;
  }
) {
  const identity = await getOrCreateBuyerIdentity(userId);
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw new NotFoundError("Review not found");

  if (review.buyerIdentityId !== identity.id) {
    throw new ForbiddenError("Only the review author can edit this review");
  }

  if (review.editableUntil.getTime() < Date.now()) {
    throw new ForbiddenError("The review edit window has expired");
  }

  if (input.rating !== undefined && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) {
    throw new ValidationError("Rating must be an integer between 1 and 5");
  }

  const prevHistory = Array.isArray(review.editHistory) ? (review.editHistory as any[]) : [];
  const nextHistory = [
    ...prevHistory,
    {
      editedAt: new Date().toISOString(),
      previousRating: review.rating,
      previousTitle: review.title,
      previousComment: review.comment,
    },
  ];

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: {
      ...(input.rating !== undefined ? { rating: input.rating } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      editCount: { increment: 1 },
      editHistory: nextHistory as Prisma.InputJsonValue,
    },
  });

  await computeAndPersistSellerReputation(review.businessId);
  if (review.productId) {
    await syncProductDiscoveryIndex(review.productId);
  }

  return updated;
}

/**
 * Sellers may post a public response, but are strictly blocked from editing or deleting reviews.
 */
export async function addSellerResponseToReview(
  businessId: string,
  responderUserId: string,
  reviewId: string,
  responseText: string
) {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, businessId },
  });
  if (!review) throw new NotFoundError("Review not found in business");

  return prisma.review.update({
    where: { id: review.id },
    data: {
      sellerResponse: responseText.trim(),
      sellerRespondedAt: new Date(),
      sellerResponderId: responderUserId,
    },
  });
}

export async function reportReview(params: {
  reviewId: string;
  reporterType: "BUYER" | "SELLER" | "SYSTEM";
  reporterId?: string | null;
  reason: string;
  details?: string | null;
}) {
  const review = await prisma.review.findUnique({ where: { id: params.reviewId } });
  if (!review) throw new NotFoundError("Review not found");

  const report = await prisma.reviewReport.create({
    data: {
      reviewId: review.id,
      reporterType: params.reporterType,
      reporterId: params.reporterId ?? null,
      reason: params.reason.trim(),
      details: params.details ?? null,
    },
  });

  // Escalate to platform abuse review queue if multiple reports accumulate
  const openReportCount = await prisma.reviewReport.count({
    where: { reviewId: review.id, status: "OPEN" },
  });
  if (openReportCount >= 1) {
    await flagPlatformAbuse({
      targetType: "REVIEW",
      targetId: review.id,
      businessId: review.businessId,
      buyerIdentityId: review.buyerIdentityId,
      reason: `Review reported: ${params.reason}`,
      category: "REVIEW_REPORT",
      evidence: { reportId: report.id, openReportCount },
    });
  }

  return report;
}

export async function moderateReview(
  reviewId: string,
  moderatorId: string,
  input: {
    moderationState: ReviewModerationState;
    moderationNotes?: string | null;
  }
) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!review) throw new NotFoundError("Review not found");

  const prevHistory = Array.isArray(review.editHistory) ? (review.editHistory as any[]) : [];
  const nextHistory = [
    ...prevHistory,
    {
      moderatedAt: new Date().toISOString(),
      moderatorId,
      fromState: review.moderationState,
      toState: input.moderationState,
      notes: input.moderationNotes ?? null,
    },
  ];

  const updated = await prisma.review.update({
    where: { id: review.id },
    data: {
      moderationState: input.moderationState,
      moderationNotes: input.moderationNotes ?? null,
      editHistory: nextHistory as Prisma.InputJsonValue,
    },
  });

  await computeAndPersistSellerReputation(review.businessId);
  if (review.productId) {
    await syncProductDiscoveryIndex(review.productId);
  }

  return updated;
}

export async function listPublishedReviews(params: {
  businessId?: string;
  productId?: string;
  includeAllModerationStates?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.ReviewWhereInput = {
    ...(params.businessId ? { businessId: params.businessId } : {}),
    ...(params.productId ? { productId: params.productId } : {}),
    ...(params.includeAllModerationStates
      ? {}
      : { moderationState: ReviewModerationState.PUBLISHED }),
  };

  const [total, items] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      select: {
        id: true,
        businessId: true,
        productId: true,
        orderId: true,
        rating: true,
        title: true,
        comment: true,
        authorDisplayMode: true,
        authorDisplayName: true,
        moderationState: true,
        sellerResponse: true,
        sellerRespondedAt: true,
        editableUntil: true,
        editCount: true,
        createdAt: true,
        product: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  return {
    items: items.map((r) => ({
      ...r,
      editableUntil: r.editableUntil.toISOString(),
      sellerRespondedAt: r.sellerRespondedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
