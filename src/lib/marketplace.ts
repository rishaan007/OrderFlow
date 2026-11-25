import {
  AccountLifecycleStatus,
  MarketplaceOptInStatus,
  OrderSource,
  PaymentProvider,
  Prisma,
  ProductStatus,
  ReviewModerationState,
  SellerVerificationTier,
} from "@prisma/client";
import { prisma } from "./prisma";
import { toMinorUnits } from "./money";
import { getOrCreateSellerProfile } from "./reputation";
import { getTenantDb } from "./tenant";
import { createPaymentIntent } from "./payment-intents";
import { calculateOrderTotalSnapshot, snapshotToOrderDecimals } from "./tax";
import { normalizeStructuredAddress, GlobalAddressInput } from "./globalization";
import { MarketplaceUnavailableError, ValidationError } from "./errors";

function buildSearchText(params: {
  title: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  tags?: string[];
  sku?: string | null;
  sellerName: string;
}): string {
  return [
    params.title,
    params.brand,
    params.category,
    params.sku,
    params.sellerName,
    ...(params.tags ?? []),
    params.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Synchronizes a canonical Product into the materialized MarketplaceListing discovery index.
 * Does NOT duplicate the catalog — strictly indexes canonical Product, Variant, and Seller state.
 */
export async function syncProductDiscoveryIndex(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      business: {
        include: {
          sellerProfile: true,
        },
      },
      variants: true,
    },
  });

  if (!product) return null;

  const sellerProfile =
    product.business.sellerProfile ?? (await getOrCreateSellerProfile(product.businessId));

  const reputation = await prisma.networkReputation.findUnique({
    where: {
      entityType_entityId: { entityType: "SELLER", entityId: product.businessId },
    },
  });

  const reviews = await prisma.review.findMany({
    where: {
      productId: product.id,
      moderationState: ReviewModerationState.PUBLISHED,
    },
    select: { rating: true },
  });

  const reviewCount = reviews.length;
  const reviewAverage =
    reviewCount > 0
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 100) / 100
      : 0;

  const totalStock =
    product.variants.length > 0
      ? product.variants.reduce((sum, v) => sum + v.stockQuantity, 0)
      : product.stockQuantity;
  const inStock = !product.trackInventory || totalStock > 0;

  const isEligible =
    product.status === ProductStatus.ACTIVE &&
    product.marketplaceDiscoverable &&
    sellerProfile.marketplaceOptIn === MarketplaceOptInStatus.DISCOVERABLE &&
    sellerProfile.accountStatus === AccountLifecycleStatus.ACTIVE &&
    product.business.accountStatus === AccountLifecycleStatus.ACTIVE &&
    !product.business.isSandboxBusiness;

  const currency = product.business.currency || "USD";
  const priceMinorUnits = toMinorUnits(product.price, currency);
  const fulfillmentRate =
    ((reputation?.observedFacts as any)?.fulfillmentRatePercent as number | undefined) ?? 100.0;

  const searchText = buildSearchText({
    title: product.title,
    description: product.description,
    category: product.category,
    brand: product.brand,
    tags: product.tags,
    sku: product.sku,
    sellerName: sellerProfile.displayName || product.business.name,
  });

  return prisma.marketplaceListing.upsert({
    where: { productId: product.id },
    create: {
      businessId: product.businessId,
      productId: product.id,
      title: product.title,
      description: product.description,
      category: product.category,
      brand: product.brand,
      tags: product.tags,
      sku: product.sku,
      priceMinorUnits,
      currency,
      inStock,
      stockQuantity: totalStock,
      discoverable: isEligible,
      sellerVerifiedTier: sellerProfile.verificationTier,
      sellerFulfillmentRate: fulfillmentRate,
      sellerCity: sellerProfile.city,
      sellerCountryCode: sellerProfile.countryCode || product.business.countryCode,
      reviewAverage,
      reviewCount,
      searchText,
      indexedAt: new Date(),
    },
    update: {
      title: product.title,
      description: product.description,
      category: product.category,
      brand: product.brand,
      tags: product.tags,
      sku: product.sku,
      priceMinorUnits,
      currency,
      inStock,
      stockQuantity: totalStock,
      discoverable: isEligible,
      sellerVerifiedTier: sellerProfile.verificationTier,
      sellerFulfillmentRate: fulfillmentRate,
      sellerCity: sellerProfile.city,
      sellerCountryCode: sellerProfile.countryCode || product.business.countryCode,
      reviewAverage,
      reviewCount,
      searchText,
      indexedAt: new Date(),
    },
  });
}

export async function syncAllBusinessListings(businessId: string) {
  const products = await prisma.product.findMany({
    where: { businessId },
    select: { id: true },
  });
  for (const p of products) {
    await syncProductDiscoveryIndex(p.id);
  }
}

export async function setProductMarketplaceVisibility(
  businessId: string,
  productId: string,
  discoverable: boolean,
  extras?: { brand?: string | null; tags?: string[]; category?: string | null }
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
  });
  if (!product) {
    throw new MarketplaceUnavailableError("Product not found in active business");
  }

  await prisma.product.update({
    where: { id: productId },
    data: {
      marketplaceDiscoverable: discoverable,
      ...(extras?.brand !== undefined ? { brand: extras.brand } : {}),
      ...(extras?.tags !== undefined ? { tags: extras.tags } : {}),
      ...(extras?.category !== undefined ? { category: extras.category } : {}),
    },
  });

  return syncProductDiscoveryIndex(productId);
}

export interface MarketplaceSearchParams {
  query?: string;
  category?: string;
  brand?: string;
  sellerId?: string;
  inStockOnly?: boolean;
  verifiedOnly?: boolean;
  minPriceMinorUnits?: number;
  maxPriceMinorUnits?: number;
  countryCode?: string;
  city?: string;
  sortBy?: "RELEVANCE" | "PRICE_ASC" | "PRICE_DESC" | "RATING";
  page?: number;
  limit?: number;
}

/**
 * Search products across explicitly opted-in sellers and discoverable products.
 * Returns transparent, explainable ranking factors with zero hidden paid placement.
 */
export async function searchMarketplaceProducts(params: MarketplaceSearchParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;
  const query = params.query?.trim().toLowerCase() || "";

  const where: Prisma.MarketplaceListingWhereInput = {
    discoverable: true,
    ...(params.category
      ? { category: { equals: params.category.trim(), mode: "insensitive" } }
      : {}),
    ...(params.brand ? { brand: { equals: params.brand.trim(), mode: "insensitive" } } : {}),
    ...(params.sellerId ? { businessId: params.sellerId } : {}),
    ...(params.inStockOnly ? { inStock: true } : {}),
    ...(params.verifiedOnly
      ? { sellerVerifiedTier: { not: SellerVerificationTier.UNVERIFIED } }
      : {}),
    ...(params.countryCode
      ? { sellerCountryCode: params.countryCode.trim().toUpperCase() }
      : {}),
    ...(params.city ? { sellerCity: { contains: params.city.trim(), mode: "insensitive" } } : {}),
    ...(params.minPriceMinorUnits !== undefined || params.maxPriceMinorUnits !== undefined
      ? {
          priceMinorUnits: {
            ...(params.minPriceMinorUnits !== undefined ? { gte: params.minPriceMinorUnits } : {}),
            ...(params.maxPriceMinorUnits !== undefined ? { lte: params.maxPriceMinorUnits } : {}),
          },
        }
      : {}),
    ...(query
      ? {
          OR: [
            { title: { equals: query, mode: "insensitive" } },
            { title: { startsWith: query, mode: "insensitive" } },
            { searchText: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  let orderBy: Prisma.MarketplaceListingOrderByWithRelationInput[] = [
    { sellerFulfillmentRate: "desc" },
    { reviewAverage: "desc" },
    { updatedAt: "desc" },
  ];

  if (params.sortBy === "PRICE_ASC") {
    orderBy = [{ priceMinorUnits: "asc" }, { updatedAt: "desc" }];
  } else if (params.sortBy === "PRICE_DESC") {
    orderBy = [{ priceMinorUnits: "desc" }, { updatedAt: "desc" }];
  } else if (params.sortBy === "RATING") {
    orderBy = [{ reviewAverage: "desc" }, { reviewCount: "desc" }];
  }

  const [total, rawListings] = await Promise.all([
    prisma.marketplaceListing.count({ where }),
    prisma.marketplaceListing.findMany({
      where,
      include: {
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            sellerProfile: {
              select: {
                displayName: true,
                city: true,
                countryCode: true,
                verificationTier: true,
              },
            },
          },
        },
        product: {
          select: {
            id: true,
            variants: {
              select: { id: true, title: true, price: true, stockQuantity: true },
            },
          },
        },
      },
      orderBy,
      take: limit,
      skip,
    }),
  ]);

  const ranked = rawListings.map((item) => {
    const titleLower = item.title.toLowerCase();
    const isExactMatch = Boolean(query && titleLower === query);
    const isPrefixMatch = Boolean(query && titleLower.startsWith(query));

    let relevanceScore = 0;
    if (isExactMatch) relevanceScore += 50;
    else if (isPrefixMatch) relevanceScore += 30;
    else if (query) relevanceScore += 15;

    if (item.inStock) relevanceScore += 15;
    if (item.sellerVerifiedTier !== SellerVerificationTier.UNVERIFIED) relevanceScore += 15;
    relevanceScore += Math.round((item.sellerFulfillmentRate / 100) * 15);
    relevanceScore += Math.min(5, Math.round(item.reviewAverage));

    return {
      listingId: item.id,
      productId: item.productId,
      businessId: item.businessId,
      title: item.title,
      description: item.description,
      category: item.category,
      brand: item.brand,
      tags: item.tags,
      priceMinorUnits: item.priceMinorUnits,
      currency: item.currency,
      inStock: item.inStock,
      stockQuantity: item.stockQuantity,
      reviewAverage: item.reviewAverage,
      reviewCount: item.reviewCount,
      seller: {
        id: item.business.id,
        slug: item.business.slug,
        name: item.business.sellerProfile?.displayName || item.business.name,
        logoUrl: item.business.logoUrl,
        city: item.business.sellerProfile?.city || item.sellerCity,
        countryCode: item.business.sellerProfile?.countryCode || item.sellerCountryCode,
        verificationTier: item.sellerVerifiedTier,
        fulfillmentRate: item.sellerFulfillmentRate,
      },
      variants: item.product.variants.map((v) => ({
        id: v.id,
        title: v.title,
        priceMinorUnits: toMinorUnits(v.price, item.currency),
        stockQuantity: v.stockQuantity,
      })),
      rankingFactors: {
        explainableScore: relevanceScore,
        exactTitleMatch: isExactMatch,
        prefixTitleMatch: isPrefixMatch,
        inStock: item.inStock,
        verifiedSeller: item.sellerVerifiedTier !== SellerVerificationTier.UNVERIFIED,
        fulfillmentRatePercent: item.sellerFulfillmentRate,
        sponsored: false,
      },
    };
  });

  if (!params.sortBy || params.sortBy === "RELEVANCE") {
    ranked.sort((a, b) => b.rankingFactors.explainableScore - a.rankingFactors.explainableScore);
  }

  return {
    items: ranked,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function searchMarketplaceSellers(params?: {
  query?: string;
  category?: string;
  verifiedOnly?: boolean;
  countryCode?: string;
  city?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params?.page ?? 1);
  const limit = Math.min(50, Math.max(1, params?.limit ?? 20));
  const skip = (page - 1) * limit;
  const query = params?.query?.trim();

  const where: Prisma.SellerProfileWhereInput = {
    marketplaceOptIn: MarketplaceOptInStatus.DISCOVERABLE,
    accountStatus: AccountLifecycleStatus.ACTIVE,
    business: {
      accountStatus: AccountLifecycleStatus.ACTIVE,
      isSandboxBusiness: false,
    },
    ...(params?.category ? { categories: { has: params.category.trim() } } : {}),
    ...(params?.verifiedOnly
      ? { verificationTier: { not: SellerVerificationTier.UNVERIFIED } }
      : {}),
    ...(params?.countryCode
      ? { countryCode: params.countryCode.trim().toUpperCase() }
      : {}),
    ...(params?.city ? { city: { contains: params.city.trim(), mode: "insensitive" } } : {}),
    ...(query
      ? {
          OR: [
            { displayName: { contains: query, mode: "insensitive" } },
            { tagline: { contains: query, mode: "insensitive" } },
            { about: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, profiles] = await Promise.all([
    prisma.sellerProfile.count({ where }),
    prisma.sellerProfile.findMany({
      where,
      include: {
        business: {
          select: {
            id: true,
            slug: true,
            currency: true,
            logoUrl: true,
            _count: {
              select: {
                marketplaceListings: { where: { discoverable: true } },
              },
            },
          },
        },
      },
      orderBy: [{ verificationTier: "desc" }, { updatedAt: "desc" }],
      take: limit,
      skip,
    }),
  ]);

  const sellerIds = profiles.map((p) => p.businessId);
  const reputations = await prisma.networkReputation.findMany({
    where: {
      entityType: "SELLER",
      entityId: { in: sellerIds },
    },
  });
  const repMap = new Map(reputations.map((r) => [r.entityId, r]));

  return {
    items: profiles.map((p) => {
      const rep = repMap.get(p.businessId);
      return {
        businessId: p.businessId,
        slug: p.business.slug,
        displayName: p.displayName,
        tagline: p.tagline,
        categories: p.categories,
        city: p.city,
        state: p.state,
        countryCode: p.countryCode,
        logoUrl: p.logoUrl || p.business.logoUrl,
        verificationTier: p.verificationTier,
        discoverableProductsCount: p.business._count.marketplaceListings,
        reputationSummary: rep
          ? {
              badges: rep.derivedBadges,
              reviewStats: rep.reviewStats,
              explanation: rep.explanation,
            }
          : null,
      };
    }),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function recordMarketplaceListingView(productId: string) {
  await prisma.marketplaceListing.updateMany({
    where: { productId, discoverable: true },
    data: { viewsCount: { increment: 1 } },
  });
}

/**
 * Executes a transaction from a marketplace listing using the SINGLE unified OrderFlow
 * commerce infrastructure (SocialTransaction -> Order -> PaymentIntent -> Ledger/Fulfillment).
 */
export async function executeMarketplaceCheckout(input: {
  productId: string;
  variantId?: string | null;
  quantity: number;
  buyerUserId?: string | null;
  buyerIdentityId?: string | null;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  shippingAddress: GlobalAddressInput;
  paymentProvider?: PaymentProvider;
  notes?: string | null;
}) {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    include: {
      business: {
        include: { sellerProfile: true },
      },
      variants: true,
    },
  });

  if (!product || product.status !== ProductStatus.ACTIVE || !product.marketplaceDiscoverable) {
    throw new MarketplaceUnavailableError("Product is not discoverable for marketplace checkout");
  }

  const sellerProfile = product.business.sellerProfile;
  if (
    !sellerProfile ||
    sellerProfile.marketplaceOptIn !== MarketplaceOptInStatus.DISCOVERABLE ||
    sellerProfile.accountStatus !== AccountLifecycleStatus.ACTIVE ||
    product.business.accountStatus !== AccountLifecycleStatus.ACTIVE
  ) {
    throw new MarketplaceUnavailableError("Seller has not opted into marketplace discovery");
  }

  let unitPrice = Number(product.price);
  let variantTitle: string | null = null;
  let sku = product.sku;

  if (input.variantId) {
    const variant = product.variants.find((v) => v.id === input.variantId);
    if (!variant) throw new ValidationError("Selected product variant not found");
    unitPrice = Number(variant.price);
    variantTitle = variant.title;
    sku = variant.sku || product.sku;
  }

  const normalizedAddress = normalizeStructuredAddress(input.shippingAddress);
  const currency = product.business.currency || "USD";
  const unitPriceMinor = toMinorUnits(unitPrice, currency);
  const subtotalMinorUnits = unitPriceMinor * input.quantity;

  const snapshot = await calculateOrderTotalSnapshot({
    subtotalMinorUnits,
    discountMinorUnits: 0,
    shippingMinorUnits: 0,
    feesMinorUnits: 0,
    currency,
    countryCode: normalizedAddress.countryCode,
    stateCode: normalizedAddress.state,
    category: product.category,
    businessId: product.businessId,
  });
  const snapshotDecimals = snapshotToOrderDecimals(snapshot);

  const tenantDb = getTenantDb(product.businessId);
  const order = await tenantDb.createOrder({
    newCustomer: {
      name: normalizedAddress.name,
      phone: normalizedAddress.phone || input.buyerPhone || null,
      email: input.buyerEmail || null,
      address: normalizedAddress.formattedSingleLine,
    },
    source: OrderSource.MARKETPLACE,
    shipping: Number(snapshotDecimals.shipping),
    tax: Number(snapshotDecimals.tax),
    shippingAddress: normalizedAddress.formattedSingleLine,
    customerNotes: input.notes || undefined,
    items: [
      {
        productId: product.id,
        variantId: input.variantId || null,
        title: product.title,
        variantTitle,
        sku,
        quantity: input.quantity,
        unitPrice,
      },
    ],
  });

  // Persist structured snapshot and bind buyer identity if signed in
  await prisma.order.update({
    where: { id: order.id },
    data: {
      feesMinorUnits: snapshotDecimals.feesMinorUnits,
      totalSnapshot: snapshotDecimals.totalSnapshot,
      taxBreakdown: snapshotDecimals.taxBreakdown,
      shippingAddressStructured: normalizedAddress as unknown as Prisma.InputJsonValue,
    },
  });

  if (order.socialTransaction && (input.buyerUserId || input.buyerIdentityId)) {
    await prisma.socialTransaction.update({
      where: { id: order.socialTransaction.id },
      data: {
        ...(input.buyerUserId ? { buyerUserId: input.buyerUserId } : {}),
        ...(input.buyerIdentityId ? { buyerIdentityId: input.buyerIdentityId } : {}),
      },
    });
  }

  const paymentIntent = await createPaymentIntent(product.businessId, {
    orderId: order.id,
    provider: input.paymentProvider ?? PaymentProvider.MANUAL,
    amountMinorUnits: snapshot.grandTotalMinorUnits,
    currency,
    idempotencyKey: `mkt_${order.id}`,
    description: `Marketplace order #${order.orderNumber}`,
  });

  await prisma.marketplaceListing.updateMany({
    where: { productId: product.id },
    data: { ordersCount: { increment: 1 } },
  });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    transactionId: order.socialTransaction?.id ?? null,
    trackingToken: order.socialTransaction?.publicTrackingToken ?? null,
    paymentIntentId: paymentIntent.id,
    totalSnapshot: snapshot,
  };
}
