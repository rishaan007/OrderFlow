import crypto from "crypto";
import {
  AccountLifecycleStatus,
  IdentityConfidence,
  MarketplaceOptInStatus,
  PrivacyVisibility,
  Prisma,
  ReviewModerationState,
  SellerVerificationTier,
  VerificationRequestStatus,
} from "@prisma/client";
import { prisma } from "./prisma";
import { getSellerTrustProfile, getBuyerTrustProfile } from "./trust-profile";
import { NotFoundError, ValidationError } from "./errors";
import { normalizeCountryCode } from "./globalization";

export interface ReputationBadge {
  code:
    | "VERIFIED_BUYER"
    | "ESTABLISHED_BUYER"
    | "VERIFIED_SELLER"
    | "ESTABLISHED_SELLER"
    | "RELIABLE_FULFILLMENT"
    | "CONSISTENT_DELIVERY"
    | "LOW_DISPUTE_RATE";
  label: string;
  explanation: string;
}

export interface ExplainableNetworkReputation {
  entityType: "SELLER" | "BUYER";
  entityId: string;
  observedFacts: Record<string, string | number | boolean | null>;
  derivedReputation: {
    badges: ReputationBadge[];
    verificationLevel: string;
  };
  userReviews: {
    averageRating: number;
    reviewCount: number;
    ratingBreakdown: Record<string, number>;
  } | null;
  sampleSize: number;
  observationWindow: string;
  verificationLevel: string;
  explanation: string;
  modelVersion: string;
  computedAt: string;
}

/**
 * Ensures a SellerProfile exists for a business (explicitly NOT_DISCOVERABLE by default).
 */
export async function getOrCreateSellerProfile(businessId: string) {
  const existing = await prisma.sellerProfile.findUnique({ where: { businessId } });
  if (existing) return existing;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { profile: true },
  });
  if (!business) throw new NotFoundError("Business not found");

  return prisma.sellerProfile.create({
    data: {
      businessId: business.id,
      displayName: business.name,
      logoUrl: business.logoUrl,
      countryCode: business.countryCode || "US",
      marketplaceOptIn: MarketplaceOptInStatus.NOT_DISCOVERABLE,
      verificationTier: SellerVerificationTier.UNVERIFIED,
      supportedCurrencies: [business.currency || "USD"],
      supportedLocales: [business.locale || "en"],
      accountStatus: business.accountStatus,
      socialLinks: {
        instagram: business.profile?.instagramHandle ?? null,
        whatsapp: business.profile?.whatsappNumber ?? null,
      },
    },
  });
}

export async function updateSellerNetworkProfile(
  businessId: string,
  input: {
    displayName?: string;
    tagline?: string | null;
    about?: string | null;
    categories?: string[];
    city?: string | null;
    state?: string | null;
    countryCode?: string | null;
    websiteUrl?: string | null;
    marketplaceOptIn?: MarketplaceOptInStatus;
    returnPolicySummary?: string | null;
    supportedCurrencies?: string[];
    supportedLocales?: string[];
  }
) {
  await getOrCreateSellerProfile(businessId);

  const countryCode = input.countryCode
    ? normalizeCountryCode(input.countryCode)
    : undefined;

  const updated = await prisma.sellerProfile.update({
    where: { businessId },
    data: {
      ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
      ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
      ...(input.about !== undefined ? { about: input.about } : {}),
      ...(input.categories !== undefined ? { categories: input.categories } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(countryCode !== undefined ? { countryCode } : {}),
      ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl || null } : {}),
      ...(input.marketplaceOptIn !== undefined ? { marketplaceOptIn: input.marketplaceOptIn } : {}),
      ...(input.returnPolicySummary !== undefined
        ? { returnPolicySummary: input.returnPolicySummary }
        : {}),
      ...(input.supportedCurrencies !== undefined
        ? { supportedCurrencies: input.supportedCurrencies.map((c) => c.toUpperCase()) }
        : {}),
      ...(input.supportedLocales !== undefined ? { supportedLocales: input.supportedLocales } : {}),
    },
  });

  // Synchronize marketplace discovery flags across all listings belonging to this seller
  if (
    input.marketplaceOptIn !== undefined ||
    input.city !== undefined ||
    countryCode !== undefined
  ) {
    const { syncAllBusinessListings } = await import("./marketplace");
    await syncAllBusinessListings(businessId);
  }

  return updated;
}

/**
 * Submits evidence-backed seller verification. Never fakes verified status without an explicit proof record.
 */
export async function submitSellerVerification(
  businessId: string,
  input: {
    requestedTier: SellerVerificationTier;
    verificationMethod: string;
    evidenceReference: string;
    reviewerNotes?: string | null;
  }
) {
  if (input.requestedTier === SellerVerificationTier.UNVERIFIED) {
    throw new ValidationError("Cannot request UNVERIFIED tier");
  }
  await getOrCreateSellerProfile(businessId);

  const evidenceHash = crypto
    .createHash("sha256")
    .update(`${businessId}:${input.verificationMethod}:${input.evidenceReference}`, "utf8")
    .digest("hex");

  const verification = await prisma.sellerVerification.create({
    data: {
      businessId,
      requestedTier: input.requestedTier,
      status: VerificationRequestStatus.PENDING,
      verificationMethod: input.verificationMethod.trim(),
      evidenceHash,
      evidenceReference: input.evidenceReference.trim(),
      reviewerNotes: input.reviewerNotes ?? null,
    },
  });

  return verification;
}

/**
 * Approves or rejects an evidence-backed seller verification request.
 * Only approved verification checks elevate SellerProfile.verificationTier.
 */
export async function reviewSellerVerification(
  verificationId: string,
  decision: {
    status: "VERIFIED" | "REJECTED";
    verifiedBy: string;
    reviewerNotes?: string | null;
  }
) {
  const req = await prisma.sellerVerification.findUnique({ where: { id: verificationId } });
  if (!req) throw new NotFoundError("Verification request not found");

  const result = await prisma.$transaction(async (tx) => {
    const updatedReq = await tx.sellerVerification.update({
      where: { id: verificationId },
      data: {
        status:
          decision.status === "VERIFIED"
            ? VerificationRequestStatus.VERIFIED
            : VerificationRequestStatus.REJECTED,
        verifiedBy: decision.verifiedBy,
        verifiedAt: decision.status === "VERIFIED" ? new Date() : null,
        reviewerNotes: decision.reviewerNotes ?? req.reviewerNotes,
      },
    });

    if (decision.status === "VERIFIED") {
      await tx.sellerProfile.upsert({
        where: { businessId: req.businessId },
        create: {
          businessId: req.businessId,
          displayName: "Seller",
          verificationTier: req.requestedTier,
          verifiedAt: new Date(),
        },
        update: {
          verificationTier: req.requestedTier,
          verifiedAt: new Date(),
        },
      });

      await tx.marketplaceListing.updateMany({
        where: { businessId: req.businessId },
        data: { sellerVerifiedTier: req.requestedTier },
      });
    }

    return updatedReq;
  });

  await computeAndPersistSellerReputation(req.businessId);
  return result;
}

/**
 * Computes explainable NetworkReputation separating Observed Facts, Derived Reputation Badges,
 * and User Reviews — never collapsing into an opaque numerical score.
 */
export async function computeAndPersistSellerReputation(
  businessId: string
): Promise<ExplainableNetworkReputation> {
  const [sellerProfile, trustProfile, reviews] = await Promise.all([
    getOrCreateSellerProfile(businessId),
    getSellerTrustProfile(businessId, { windowDays: 180 }),
    prisma.review.findMany({
      where: {
        businessId,
        moderationState: ReviewModerationState.PUBLISHED,
      },
      select: { rating: true },
    }),
  ]);

  const badges: ReputationBadge[] = [];
  if (sellerProfile.verificationTier !== SellerVerificationTier.UNVERIFIED) {
    badges.push({
      code: "VERIFIED_SELLER",
      label: "Verified Seller",
      explanation: `Identity/business verified via ${sellerProfile.verificationTier.toLowerCase().replace(/_/g, " ")}.`,
    });
  }
  if (trustProfile.summary.isEstablishedSeller) {
    badges.push({
      code: "ESTABLISHED_SELLER",
      label: "Established Seller",
      explanation: `${trustProfile.summary.totalOrdersInWindow} live orders processed in the 180-day window.`,
    });
  }
  if (
    trustProfile.metrics.fulfillmentRate.sampleSize >= 3 &&
    trustProfile.metrics.fulfillmentRate.value >= 90
  ) {
    badges.push({
      code: "RELIABLE_FULFILLMENT",
      label: "Reliable Fulfillment",
      explanation: `${trustProfile.metrics.fulfillmentRate.value}% fulfillment across ${trustProfile.metrics.fulfillmentRate.sampleSize} eligible orders.`,
    });
  }
  if (
    trustProfile.metrics.deliverySuccessRate.sampleSize >= 3 &&
    trustProfile.metrics.deliverySuccessRate.value >= 90
  ) {
    badges.push({
      code: "CONSISTENT_DELIVERY",
      label: "Consistent Delivery",
      explanation: `${trustProfile.metrics.deliverySuccessRate.value}% successful deliveries without loss disputes.`,
    });
  }
  if (
    trustProfile.summary.totalOrdersInWindow >= 3 &&
    trustProfile.summary.disputeRatePercentage <= 3.0
  ) {
    badges.push({
      code: "LOW_DISPUTE_RATE",
      label: "Low Dispute Rate",
      explanation: `${trustProfile.summary.disputeRatePercentage}% dispute rate in the past 180 days.`,
    });
  }

  const ratingBreakdown: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let ratingSum = 0;
  for (const r of reviews) {
    const key = String(Math.min(5, Math.max(1, r.rating)));
    ratingBreakdown[key] = (ratingBreakdown[key] || 0) + 1;
    ratingSum += r.rating;
  }
  const reviewCount = reviews.length;
  const averageRating =
    reviewCount > 0 ? Math.round((ratingSum / reviewCount) * 100) / 100 : 0;

  const observedFacts = {
    verificationTier: sellerProfile.verificationTier,
    totalOrders180d: trustProfile.summary.totalOrdersInWindow,
    fulfillmentRatePercent: trustProfile.metrics.fulfillmentRate.value,
    deliverySuccessRatePercent: trustProfile.metrics.deliverySuccessRate.value,
    disputeRatePercent: trustProfile.metrics.disputeRate.value,
    refundRatePercent: trustProfile.metrics.refundRate.value,
    averageFulfillmentHours: trustProfile.metrics.averageFulfillmentHours.value,
  };

  const reviewStats = {
    averageRating,
    reviewCount,
    ratingBreakdown,
  };

  const explanation =
    badges.length > 0
      ? `Seller holds ${badges.map((b) => b.label).join(", ")} based on ${trustProfile.summary.totalOrdersInWindow} orders over 180 days.`
      : `Seller has ${trustProfile.summary.totalOrdersInWindow} orders recorded in the 180-day observation window.`;

  const computedAt = new Date();
  await prisma.networkReputation.upsert({
    where: {
      entityType_entityId: { entityType: "SELLER", entityId: businessId },
    },
    create: {
      entityType: "SELLER",
      entityId: businessId,
      observedFacts: observedFacts as Prisma.InputJsonValue,
      derivedBadges: badges as unknown as Prisma.InputJsonValue,
      reviewStats: reviewStats as Prisma.InputJsonValue,
      sampleSize: trustProfile.summary.totalOrdersInWindow,
      observationWindow: "180d",
      verificationLevel: sellerProfile.verificationTier,
      explanation,
      modelVersion: "v2",
      computedAt,
    },
    update: {
      observedFacts: observedFacts as Prisma.InputJsonValue,
      derivedBadges: badges as unknown as Prisma.InputJsonValue,
      reviewStats: reviewStats as Prisma.InputJsonValue,
      sampleSize: trustProfile.summary.totalOrdersInWindow,
      verificationLevel: sellerProfile.verificationTier,
      explanation,
      computedAt,
    },
  });

  // Update marketplace index summary stats
  await prisma.marketplaceListing.updateMany({
    where: { businessId },
    data: {
      sellerVerifiedTier: sellerProfile.verificationTier,
      sellerFulfillmentRate: trustProfile.metrics.fulfillmentRate.value,
    },
  });

  return {
    entityType: "SELLER",
    entityId: businessId,
    observedFacts,
    derivedReputation: {
      badges,
      verificationLevel: sellerProfile.verificationTier,
    },
    userReviews: reviewStats,
    sampleSize: trustProfile.summary.totalOrdersInWindow,
    observationWindow: "180d",
    verificationLevel: sellerProfile.verificationTier,
    explanation,
    modelVersion: "v2",
    computedAt: computedAt.toISOString(),
  };
}

/**
 * Computes explainable Buyer Network Reputation respecting PrivacyVisibility settings.
 */
export async function computeAndPersistBuyerReputation(
  buyerIdentityId: string,
  requesterRole: "BUYER_SELF" | "SELLER" | "PUBLIC" = "BUYER_SELF"
): Promise<ExplainableNetworkReputation | null> {
  const buyer = await prisma.buyerIdentity.findUnique({
    where: { id: buyerIdentityId },
    select: { id: true, networkVisibility: true, verificationLevel: true, status: true },
  });
  if (!buyer) throw new NotFoundError("Buyer identity not found");

  // Enforce explicit buyer privacy controls
  if (requesterRole === "PUBLIC" && buyer.networkVisibility !== PrivacyVisibility.PUBLIC && buyer.networkVisibility !== PrivacyVisibility.NETWORK_VISIBLE) {
    return null;
  }
  if (requesterRole === "SELLER" && buyer.networkVisibility === PrivacyVisibility.PRIVATE) {
    return null;
  }

  const profile = await getBuyerTrustProfile(buyerIdentityId, { windowDays: 365 });
  const badges: ReputationBadge[] = [];

  if (profile.identity.verificationLevel !== IdentityConfidence.UNVERIFIED) {
    badges.push({
      code: "VERIFIED_BUYER",
      label: "Verified Buyer",
      explanation: `Buyer has verified ${profile.metrics.verifiedChannelsCount.value} identity channel(s).`,
    });
  }
  if (profile.summary.isEstablishedBuyer) {
    badges.push({
      code: "ESTABLISHED_BUYER",
      label: "Established Buyer",
      explanation: `${profile.summary.totalCompletedTransactions} completed transactions over a 365-day observation window.`,
    });
  }
  if (
    profile.summary.totalCompletedTransactions >= 2 &&
    (profile.summary.disputeRateBucket === "NONE" || profile.summary.disputeRateBucket === "LOW")
  ) {
    badges.push({
      code: "LOW_DISPUTE_RATE",
      label: "Low Dispute Rate",
      explanation: `Dispute rate tier is ${profile.summary.disputeRateBucket} across ${profile.metrics.completedTransactions.sampleSize} transactions.`,
    });
  }

  const observedFacts = {
    verificationLevel: profile.identity.verificationLevel,
    completedTransactions365d: profile.summary.totalCompletedTransactions,
    accountAgeDays: profile.metrics.accountAgeDays.value,
    disputeRateBucket: profile.summary.disputeRateBucket,
    verifiedChannelsCount: profile.metrics.verifiedChannelsCount.value,
  };

  const explanation =
    badges.length > 0
      ? `Buyer earns ${badges.map((b) => b.label).join(", ")} across ${profile.summary.totalCompletedTransactions} completed transactions.`
      : "New or limited history buyer identity on OrderFlow.";

  const computedAt = new Date();
  await prisma.networkReputation.upsert({
    where: {
      entityType_entityId: { entityType: "BUYER", entityId: buyerIdentityId },
    },
    create: {
      entityType: "BUYER",
      entityId: buyerIdentityId,
      observedFacts: observedFacts as Prisma.InputJsonValue,
      derivedBadges: badges as unknown as Prisma.InputJsonValue,
      sampleSize: profile.metrics.completedTransactions.sampleSize,
      observationWindow: "365d",
      verificationLevel: profile.identity.verificationLevel,
      explanation,
      modelVersion: "v2",
      computedAt,
    },
    update: {
      observedFacts: observedFacts as Prisma.InputJsonValue,
      derivedBadges: badges as unknown as Prisma.InputJsonValue,
      sampleSize: profile.metrics.completedTransactions.sampleSize,
      verificationLevel: profile.identity.verificationLevel,
      explanation,
      computedAt,
    },
  });

  return {
    entityType: "BUYER",
    entityId: buyerIdentityId,
    observedFacts,
    derivedReputation: {
      badges,
      verificationLevel: profile.identity.verificationLevel,
    },
    userReviews: null,
    sampleSize: profile.metrics.completedTransactions.sampleSize,
    observationWindow: "365d",
    verificationLevel: profile.identity.verificationLevel,
    explanation,
    modelVersion: "v2",
    computedAt: computedAt.toISOString(),
  };
}

/**
 * Returns strict public seller network profile — excludes all private customers,
 * internal risk scores, reconciliation data, and confidential financials.
 */
export async function getPublicSellerProfile(businessIdOrSlug: string) {
  const business = await prisma.business.findFirst({
    where: {
      OR: [{ id: businessIdOrSlug }, { slug: businessIdOrSlug }],
      isSandboxBusiness: false,
    },
    include: {
      profile: {
        select: {
          instagramHandle: true,
          whatsappNumber: true,
        },
      },
      sellerProfile: true,
    },
  });

  if (!business || business.accountStatus !== AccountLifecycleStatus.ACTIVE) {
    throw new NotFoundError("Seller network profile not found");
  }

  const profile = await getOrCreateSellerProfile(business.id);
  if (profile.accountStatus !== AccountLifecycleStatus.ACTIVE) {
    throw new NotFoundError("Seller network profile is not active");
  }

  const reputation = await computeAndPersistSellerReputation(business.id);

  const [reviews, discoverableProducts] = await Promise.all([
    prisma.review.findMany({
      where: {
        businessId: business.id,
        moderationState: ReviewModerationState.PUBLISHED,
      },
      select: {
        id: true,
        productId: true,
        rating: true,
        title: true,
        comment: true,
        authorDisplayName: true,
        sellerResponse: true,
        sellerRespondedAt: true,
        createdAt: true,
        product: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    profile.marketplaceOptIn === MarketplaceOptInStatus.DISCOVERABLE
      ? prisma.marketplaceListing.findMany({
          where: {
            businessId: business.id,
            discoverable: true,
          },
          select: {
            id: true,
            productId: true,
            title: true,
            description: true,
            category: true,
            brand: true,
            priceMinorUnits: true,
            currency: true,
            inStock: true,
            reviewAverage: true,
            reviewCount: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  return {
    businessId: business.id,
    slug: business.slug,
    identity: {
      displayName: profile.displayName || business.name,
      tagline: profile.tagline,
      about: profile.about,
      categories: profile.categories,
      city: profile.city,
      state: profile.state,
      countryCode: profile.countryCode || business.countryCode,
      logoUrl: profile.logoUrl || business.logoUrl,
      coverImageUrl: profile.coverImageUrl,
      websiteUrl: profile.websiteUrl,
    },
    verification: {
      tier: profile.verificationTier,
      verifiedAt: profile.verifiedAt?.toISOString() ?? null,
    },
    marketplace: {
      optInStatus: profile.marketplaceOptIn,
      isDiscoverable: profile.marketplaceOptIn === MarketplaceOptInStatus.DISCOVERABLE,
    },
    returnPolicySummary: profile.returnPolicySummary,
    socialPresence: {
      instagramHandle: business.profile?.instagramHandle ?? null,
      whatsappConnected: Boolean(business.profile?.whatsappNumber),
    },
    reputation,
    reviews: reviews.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      sellerRespondedAt: r.sellerRespondedAt?.toISOString() ?? null,
    })),
    products: discoverableProducts,
  };
}
