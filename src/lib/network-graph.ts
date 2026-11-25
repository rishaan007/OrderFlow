import { SellerVerificationTier } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Privacy-safe transaction-aware recommendations without addictive engagement loops
 * or exposure of private cross-buyer transaction graphs.
 */
export async function getTransactionAwareRecommendations(params: {
  category?: string | null;
  excludeProductId?: string | null;
  limit?: number;
}) {
  const limit = Math.min(12, Math.max(1, params.limit ?? 4));

  const relatedListings = await prisma.marketplaceListing.findMany({
    where: {
      discoverable: true,
      inStock: true,
      ...(params.category
        ? { category: { equals: params.category, mode: "insensitive" } }
        : {}),
      ...(params.excludeProductId
        ? { productId: { not: params.excludeProductId } }
        : {}),
    },
    select: {
      productId: true,
      businessId: true,
      title: true,
      category: true,
      priceMinorUnits: true,
      currency: true,
      sellerVerifiedTier: true,
      sellerFulfillmentRate: true,
      reviewAverage: true,
      business: { select: { name: true, slug: true } },
    },
    orderBy: [
      { sellerFulfillmentRate: "desc" },
      { reviewAverage: "desc" },
      { ordersCount: "desc" },
    ],
    take: limit,
  });

  return relatedListings.map((item) => ({
    productId: item.productId,
    businessId: item.businessId,
    sellerName: item.business.name,
    sellerSlug: item.business.slug,
    title: item.title,
    category: item.category,
    priceMinorUnits: item.priceMinorUnits,
    currency: item.currency,
    verifiedSeller: item.sellerVerifiedTier !== SellerVerificationTier.UNVERIFIED,
    fulfillmentRate: item.sellerFulfillmentRate,
    reviewAverage: item.reviewAverage,
    recommendationReason: params.category
      ? `Reliable availability in ${params.category}`
      : "High-reliability discoverable seller listing",
  }));
}
