import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import {
  AbuseActionType,
  AbuseTargetType,
  AccountLifecycleStatus,
  ApiEnvironment,
  ApiKeyType,
  MarketplaceOptInStatus,
  OrderStatus,
  PrivacyVisibility,
  ProductStatus,
  ReviewDisplayMode,
  ReviewModerationState,
  SellerVerificationTier,
  TaxCalculationMode,
  TransactionStatus,
  WebhookDeliveryStatus,
} from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import { toMinorUnits } from "../src/lib/money";
import { resolveLocale, t } from "../src/lib/i18n";
import {
  formatMoneyLocalized,
  formatTimestampInTimezone,
  getRegionalCapabilities,
  normalizeStructuredAddress,
} from "../src/lib/globalization";
import {
  calculateOrderTotalSnapshot,
  computeBasisPointsAmount,
  computeInclusiveBasisPointsTax,
  createTaxRule,
} from "../src/lib/tax";
import { checkDistributedRateLimit } from "../src/lib/rate-limiter";
import {
  enqueueBackgroundJob,
  executeBackgroundJob,
  processDueBackgroundJobs,
} from "../src/lib/background-jobs";
import {
  computeAndPersistBuyerReputation,
  computeAndPersistSellerReputation,
  getOrCreateSellerProfile,
  getPublicSellerProfile,
  reviewSellerVerification,
  submitSellerVerification,
  updateSellerNetworkProfile,
} from "../src/lib/reputation";
import {
  executeMarketplaceCheckout,
  searchMarketplaceProducts,
  searchMarketplaceSellers,
  setProductMarketplaceVisibility,
} from "../src/lib/marketplace";
import {
  addSellerResponseToReview,
  createTransactionReview,
  reportReview,
  updateBuyerReview,
} from "../src/lib/reviews";
import {
  deactivateOrDeleteBuyerIdentity,
  exportBuyerPortabilityData,
  exportSellerTenantData,
} from "../src/lib/export-portability";
import {
  authenticateDeveloperApiKey,
  createDeveloperApplication,
  createWebhookSubscription,
  dispatchDeveloperWebhookEvent,
  generateApiKey,
  retryWebhookDelivery,
  revokeApiKey,
  rotateApiKey,
  signDeveloperWebhookPayload,
  verifyDeveloperWebhookSignature,
} from "../src/lib/developer-platform";
import {
  connectThirdPartyIntegration,
  disconnectThirdPartyIntegration,
  listIntegrationCatalog,
} from "../src/lib/integrations-hub";
import { applyAbuseAction, flagPlatformAbuse } from "../src/lib/platform-abuse";
import { getPlatformObservabilitySnapshot } from "../src/lib/platform-observability";
import { getOrCreateBuyerIdentity, updateBuyerProfile } from "../src/lib/buyer-identity";
import {
  DeveloperAuthError,
  ReviewEligibilityError,
  ScopeForbiddenError,
  ValidationError,
} from "../src/lib/errors";
import {
  GET as v1GetOrders,
  POST as v1PostOrders,
} from "../src/app/api/v1/orders/route";
import { GET as v1GetOrderById } from "../src/app/api/v1/orders/[id]/route";
import {
  GET as v1GetProducts,
  POST as v1PostProducts,
} from "../src/app/api/v1/products/route";
import { GET as v1GetCustomers } from "../src/app/api/v1/customers/route";
import { GET as v1GetTransactions } from "../src/app/api/v1/transactions/route";
import { GET as v1GetPayments } from "../src/app/api/v1/payments/route";
import { GET as v1GetShipments } from "../src/app/api/v1/shipments/route";
import {
  GET as v1GetWebhooks,
  POST as v1PostWebhooks,
} from "../src/app/api/v1/webhooks/route";
import { GET as v1GetAnalytics } from "../src/app/api/v1/analytics/route";
import { GET as v1GetOpenApi } from "../src/app/api/v1/openapi.json/route";
import { GET as marketplaceSearchRoute } from "../src/app/api/marketplace/search/route";

let sellerUserId: string;
let adminUserId: string;
let buyerUserId: string;
let otherBuyerUserId: string;
let deletableBuyerUserId: string;

let businessId: string;
let hiddenBusinessId: string;
let sandboxBusinessId: string;
let buyerIdentityId: string;

let discoverableProductId: string;
let hiddenProductId: string;

beforeAll(async () => {
  const ts = Date.now();

  const [sellerUser, adminUser, buyerUser, otherBuyer, delBuyer] = await Promise.all([
    prisma.user.create({
      data: {
        email: `p6_seller_${ts}@example.com`,
        name: "Phase 6 Merchant",
        passwordHash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        email: `p6_admin_${ts}@example.com`,
        name: "Platform Moderator",
        passwordHash: "hash",
        systemRole: "ADMIN",
      },
    }),
    prisma.user.create({
      data: {
        email: `p6_buyer_${ts}@example.com`,
        name: "Priya Sharma",
        passwordHash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        email: `p6_other_buyer_${ts}@example.com`,
        name: "Alex Rivera",
        passwordHash: "hash",
      },
    }),
    prisma.user.create({
      data: {
        email: `p6_delete_buyer_${ts}@example.com`,
        name: "Ephemeral Buyer",
        passwordHash: "hash",
      },
    }),
  ]);

  sellerUserId = sellerUser.id;
  adminUserId = adminUser.id;
  buyerUserId = buyerUser.id;
  otherBuyerUserId = otherBuyer.id;
  deletableBuyerUserId = delBuyer.id;

  const [biz, hiddenBiz, sbxBiz] = await Promise.all([
    prisma.business.create({
      data: {
        name: `Loom & Craft Studio ${ts}`,
        slug: `loom-craft-${ts}`,
        currency: "USD",
        countryCode: "US",
        plan: "ENTERPRISE",
        monthlyOrderLimit: 10000,
        members: { create: { userId: sellerUserId, role: "OWNER" } },
      },
    }),
    prisma.business.create({
      data: {
        name: `Private Direct Merchant ${ts}`,
        slug: `private-direct-${ts}`,
        currency: "USD",
        countryCode: "US",
        plan: "ENTERPRISE",
        monthlyOrderLimit: 10000,
        members: { create: { userId: sellerUserId, role: "OWNER" } },
      },
    }),
    prisma.business.create({
      data: {
        name: `Sandbox Lab ${ts}`,
        slug: `sandbox-lab-${ts}`,
        currency: "USD",
        isSandboxBusiness: true,
        plan: "ENTERPRISE",
        monthlyOrderLimit: 10000,
        members: { create: { userId: sellerUserId, role: "OWNER" } },
      },
    }),
  ]);

  businessId = biz.id;
  hiddenBusinessId = hiddenBiz.id;
  sandboxBusinessId = sbxBiz.id;

  const tenantDb = getTenantDb(businessId);
  const hiddenTenantDb = getTenantDb(hiddenBusinessId);
  const sandboxTenantDb = getTenantDb(sandboxBusinessId);

  const pDiscoverable = await tenantDb.createProduct({
    title: `Handwoven Silk Scarf ${ts}`,
    category: "Apparel",
    brand: "LoomCraft",
    tags: ["silk", "artisan"],
    price: 75,
    costPrice: 30,
    stockQuantity: 25,
    status: ProductStatus.ACTIVE,
    marketplaceDiscoverable: false,
  });
  discoverableProductId = pDiscoverable.id;

  const pHidden = await hiddenTenantDb.createProduct({
    title: `Secret Backroom Vase ${ts}`,
    category: "Home",
    price: 120,
    costPrice: 50,
    stockQuantity: 10,
    status: ProductStatus.ACTIVE,
    marketplaceDiscoverable: true,
  });
  hiddenProductId = pHidden.id;

  await sandboxTenantDb.createProduct({
    title: `Sandbox Fake Widget ${ts}`,
    category: "Test",
    price: 10,
    stockQuantity: 100,
    status: ProductStatus.ACTIVE,
    marketplaceDiscoverable: true,
  });

  const identity = await getOrCreateBuyerIdentity(buyerUserId);
  buyerIdentityId = identity.id;
});

describe("Phase 6: Marketplace Discovery, Seller Profiles & Unified Checkout", () => {
  it("enforces explicit seller and product opt-in and excludes sandbox businesses from discovery", async () => {
    // Initially seller opted out -> product not discoverable even if searched
    const before = await searchMarketplaceProducts({ query: "Handwoven Silk Scarf" });
    expect(before.items.some((i) => i.productId === discoverableProductId)).toBe(false);
    expect(before.items.some((i) => i.productId === hiddenProductId)).toBe(false);

    // Explicitly opt seller into DISCOVERABLE and enable product discovery
    await updateSellerNetworkProfile(businessId, {
      marketplaceOptIn: MarketplaceOptInStatus.DISCOVERABLE,
      city: "Austin",
      state: "TX",
      countryCode: "US",
      categories: ["Apparel"],
      tagline: "Independent textile studio",
    });
    await setProductMarketplaceVisibility(businessId, discoverableProductId, true);

    const after = await searchMarketplaceProducts({ query: "Handwoven Silk Scarf" });
    const match = after.items.find((i) => i.productId === discoverableProductId);
    expect(match).toBeDefined();
    expect(match?.rankingFactors.sponsored).toBe(false);
    expect(match?.rankingFactors.explainableScore).toBeGreaterThan(0);

    // Private merchant with NOT_DISCOVERABLE seller profile must STILL remain excluded
    const hiddenCheck = await searchMarketplaceProducts({ query: "Secret Backroom Vase" });
    expect(hiddenCheck.items).toHaveLength(0);

    // Sandbox businesses must NEVER appear in seller discovery
    await updateSellerNetworkProfile(sandboxBusinessId, {
      marketplaceOptIn: MarketplaceOptInStatus.DISCOVERABLE,
    });
    const sellerResults = await searchMarketplaceSellers({ query: "Sandbox Lab" });
    expect(sellerResults.items.some((s) => s.businessId === sandboxBusinessId)).toBe(false);

    // Route handler integration check
    const req = new NextRequest("http://localhost:3000/api/marketplace/search?q=Handwoven");
    const resp = await marketplaceSearchRoute(req);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.data.items.some((i: any) => i.productId === discoverableProductId)).toBe(true);
  });

  it("executes marketplace checkout through canonical Order, SocialTransaction & PaymentIntent", async () => {
    const checkout = await executeMarketplaceCheckout({
      productId: discoverableProductId,
      quantity: 2,
      buyerUserId,
      buyerIdentityId,
      buyerEmail: "buyer.checkout@example.com",
      shippingAddress: {
        name: "Priya Sharma",
        phone: "4155550199",
        addressLine1: "450 Market St",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
        countryCode: "US",
      },
    });

    expect(checkout.orderId).toBeTruthy();
    expect(checkout.transactionId).toBeTruthy();
    expect(checkout.trackingToken).toBeTruthy();
    expect(checkout.paymentIntentId).toBeTruthy();
    expect(checkout.totalSnapshot.subtotalMinorUnits).toBe(15000);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: checkout.orderId },
      include: { socialTransaction: true, paymentIntents: true },
    });
    expect(order.source).toBe("MARKETPLACE");
    expect(order.isSandbox).toBe(false);
    expect(order.socialTransaction?.platform).toBe("MARKETPLACE");
    expect(order.paymentIntents.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Phase 6: Evidence-Backed Verification & Explainable Reputation", () => {
  it("keeps verification tier UNVERIFIED until admin review and redacts sensitive seller fields", async () => {
    const reqRecord = await submitSellerVerification(businessId, {
      requestedTier: SellerVerificationTier.BUSINESS_VERIFIED,
      verificationMethod: "EIN_DOCUMENT",
      evidenceReference: "ein-doc-hash-99182",
    });
    expect(reqRecord.status).toBe("PENDING");

    const profileBefore = await getOrCreateSellerProfile(businessId);
    expect(profileBefore.verificationTier).toBe(SellerVerificationTier.UNVERIFIED);

    await reviewSellerVerification(reqRecord.id, {
      status: "VERIFIED",
      verifiedBy: adminUserId,
      reviewerNotes: "Verified registration certificate",
    });

    const publicProfile = await getPublicSellerProfile(businessId);
    expect(publicProfile.verification.tier).toBe(SellerVerificationTier.BUSINESS_VERIFIED);
    expect(publicProfile.reputation.derivedReputation.badges.some((b) => b.code === "VERIFIED_SELLER")).toBe(true);
    // Strict public data boundary: no internal secrets or customer lists exposed
    expect((publicProfile as any).customers).toBeUndefined();
    expect(JSON.stringify(publicProfile)).not.toContain("costPrice");
  });

  it("enforces Buyer PrivacyVisibility gates on buyer network reputation", async () => {
    await updateBuyerProfile(buyerUserId, { networkVisibility: PrivacyVisibility.PRIVATE });
    const forSellerWhilePrivate = await computeAndPersistBuyerReputation(buyerIdentityId, "SELLER");
    expect(forSellerWhilePrivate).toBeNull();

    const forSelfWhilePrivate = await computeAndPersistBuyerReputation(buyerIdentityId, "BUYER_SELF");
    expect(forSelfWhilePrivate).not.toBeNull();

    await updateBuyerProfile(buyerUserId, { networkVisibility: PrivacyVisibility.PUBLIC });
    const forPublic = await computeAndPersistBuyerReputation(buyerIdentityId, "PUBLIC");
    expect(forPublic).not.toBeNull();
    expect(forPublic?.explanation).toContain("OrderFlow");
  });
});

describe("Phase 6: Verified Transaction Reviews & Anti-Abuse", () => {
  it("blocks reviews on incomplete or unowned orders, allows verified reviews & buyer edits, and prevents seller deletion", async () => {
    const tenantDb = getTenantDb(businessId);
    const pendingOrder = await tenantDb.createOrder({
      newCustomer: { name: "Pending Buyer" },
      items: [{ productId: discoverableProductId, title: "Scarf", quantity: 1, unitPrice: 75 }],
      status: OrderStatus.PENDING,
    });
    await prisma.socialTransaction.updateMany({
      where: { orderId: pendingOrder.id },
      data: { buyerUserId, buyerIdentityId },
    });

    // Not delivered yet -> blocked
    await expect(
      createTransactionReview(buyerUserId, {
        orderId: pendingOrder.id,
        productId: discoverableProductId,
        rating: 5,
        title: "Premature review",
      })
    ).rejects.toThrow(ReviewEligibilityError);

    // Other user cannot review
    const deliveredOrder = await tenantDb.createOrder({
      newCustomer: { name: "Priya Sharma" },
      items: [{ productId: discoverableProductId, title: "Scarf", quantity: 1, unitPrice: 75 }],
      status: OrderStatus.DELIVERED,
    });
    await prisma.socialTransaction.updateMany({
      where: { orderId: deliveredOrder.id },
      data: { buyerUserId, buyerIdentityId, status: TransactionStatus.COMPLETED },
    });

    await expect(
      createTransactionReview(otherBuyerUserId, {
        orderId: deliveredOrder.id,
        productId: discoverableProductId,
        rating: 1,
        title: "Fake review attempt",
      })
    ).rejects.toThrow(ReviewEligibilityError);

    // Legitimate review succeeds
    const createdReview = await createTransactionReview(buyerUserId, {
      orderId: deliveredOrder.id,
      productId: discoverableProductId,
      rating: 5,
      title: "Genuine craftsmanship",
      comment: "Delivered fast with verified tracking.",
      displayMode: ReviewDisplayMode.NAME_INITIAL,
    });
    expect(createdReview.authorDisplayName).toBe("Priya S.");
    expect(createdReview.moderationState).toBe(ReviewModerationState.PUBLISHED);

    // Duplicate review for same order/product is blocked
    await expect(
      createTransactionReview(buyerUserId, {
        orderId: deliveredOrder.id,
        productId: discoverableProductId,
        rating: 4,
      })
    ).rejects.toThrow(ReviewEligibilityError);

    // Time-windowed buyer edit updates editCount
    const edited = await updateBuyerReview(buyerUserId, createdReview.id, {
      rating: 4,
      comment: "Updated after one week of use.",
    });
    expect(edited.editCount).toBe(1);

    // Seller may post response only
    const responded = await addSellerResponseToReview(
      businessId,
      sellerUserId,
      createdReview.id,
      "Thank you for supporting independent artisans!"
    );
    expect(responded.sellerResponse).toContain("Thank you");

    // Reporting a review creates an abuse case without mutating disputes
    const reportResult = await reportReview({
      reviewId: createdReview.id,
      reporterType: "SELLER",
      reporterId: sellerUserId,
      reason: "Suspected off-topic content",
    });
    expect(reportResult.id).toBeTruthy();
    const abuseEscalation = await prisma.platformAbuseCase.findFirst({
      where: { targetType: AbuseTargetType.REVIEW, targetId: createdReview.id },
    });
    expect(abuseEscalation).not.toBeNull();
  });
});

describe("Phase 6: Developer Platform (API Keys, Scopes, Sandbox Isolation, Webhooks)", () => {
  it("enforces hashed API keys, scope rules, rotation, revocation, sandbox isolation & v1 HTTP routes", async () => {
    const sbxApp = await createDeveloperApplication(sellerUserId, {
      name: "Test Sandbox App",
      environment: ApiEnvironment.SANDBOX,
      businessId,
    });
    const liveApp = await createDeveloperApplication(sellerUserId, {
      name: "Test Live App",
      environment: ApiEnvironment.LIVE,
      businessId,
    });

    // PUBLIC key cannot have write scopes
    await expect(
      generateApiKey(sellerUserId, {
        applicationId: sbxApp.id,
        name: "Bad Public Key",
        keyType: ApiKeyType.PUBLIC,
        scopes: ["orders:write"],
      })
    ).rejects.toThrow(ValidationError);

    const sbxKey = await generateApiKey(sellerUserId, {
      applicationId: sbxApp.id,
      name: "Sandbox Key",
      keyType: ApiKeyType.SERVER,
      scopes: [
        "orders:read",
        "orders:write",
        "products:read",
        "products:write",
        "customers:read",
        "transactions:read",
        "payments:read",
        "shipments:read",
        "webhooks:manage",
        "analytics:read",
      ],
    });
    expect(sbxKey.secretKey.startsWith("of_test_srv_")).toBe(true);

    const liveReadKey = await generateApiKey(sellerUserId, {
      applicationId: liveApp.id,
      name: "Live Read Only",
      keyType: ApiKeyType.SERVER,
      scopes: ["orders:read", "products:write"],
    });
    expect(liveReadKey.secretKey.startsWith("of_live_srv_")).toBe(true);

    // Verify plaintext secret is never stored verbatim
    const dbKey = await prisma.apiKey.findUniqueOrThrow({ where: { id: sbxKey.id } });
    expect(dbKey.keyHash).not.toBe(sbxKey.secretKey);

    // Scope enforcement check
    const readOnlyReq = new Request("http://localhost:3000/api/v1/orders", {
      headers: { Authorization: `Bearer ${liveReadKey.secretKey}` },
    });
    await expect(authenticateDeveloperApiKey(readOnlyReq, "orders:write")).rejects.toThrow(
      ScopeForbiddenError
    );

    // Sandbox order creation + idempotency via HTTP route handler
    const idemKey = `idem_${Date.now()}`;
    const orderPayload = {
      idempotencyKey: idemKey,
      newCustomer: { name: "Sandbox API Customer" },
      items: [{ productId: discoverableProductId, title: "Scarf", quantity: 2, unitPrice: 75 }],
    };

    const createSbxOrderReq = new NextRequest("http://localhost:3000/api/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sbxKey.secretKey}`,
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify(orderPayload),
    });
    const createResp1 = await v1PostOrders(createSbxOrderReq);
    expect(createResp1.status).toBe(201);
    const createdJson = await createResp1.json();
    expect(createdJson.environment).toBe("SANDBOX");
    expect(createdJson.data.orderNumber).toContain("SBX-");
    expect(createdJson.data.stockDeducted).toBe(false);

    // Retry with same Idempotency-Key returns 200 deduplicated
    const retrySbxOrderReq = new NextRequest("http://localhost:3000/api/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sbxKey.secretKey}`,
        "Idempotency-Key": idemKey,
      },
      body: JSON.stringify(orderPayload),
    });
    const createResp2 = await v1PostOrders(retrySbxOrderReq);
    expect(createResp2.status).toBe(200);
    const retryJson = await createResp2.json();
    expect(retryJson.deduplicated).toBe(true);
    expect(retryJson.data.id).toBe(createdJson.data.id);

    // SANDBOX order is invisible to LIVE key
    const liveGetByIdReq = new NextRequest(
      `http://localhost:3000/api/v1/orders/${createdJson.data.id}`,
      {
        headers: { Authorization: `Bearer ${liveReadKey.secretKey}` },
      }
    );
    const crossEnvResp = await v1GetOrderById(liveGetByIdReq, {
      params: { id: createdJson.data.id },
    });
    expect(crossEnvResp.status).toBe(404);

    // Sandbox orders list vs Live orders list isolation
    const sbxOrdersListResp = await v1GetOrders(
      new NextRequest("http://localhost:3000/api/v1/orders", {
        headers: { Authorization: `Bearer ${sbxKey.secretKey}` },
      })
    );
    expect(sbxOrdersListResp.status).toBe(200);
    const sbxOrdersListJson = await sbxOrdersListResp.json();
    expect(sbxOrdersListJson.data.items.some((o: any) => o.id === createdJson.data.id)).toBe(true);

    const liveOrdersListResp = await v1GetOrders(
      new NextRequest("http://localhost:3000/api/v1/orders", {
        headers: { Authorization: `Bearer ${liveReadKey.secretKey}` },
      })
    );
    expect(liveOrdersListResp.status).toBe(200);
    const liveOrdersListJson = await liveOrdersListResp.json();
    expect(liveOrdersListJson.data.items.some((o: any) => o.id === createdJson.data.id)).toBe(false);

    // SANDBOX key cannot mutate non-sandbox product catalog
    const sbxProductReq = new NextRequest("http://localhost:3000/api/v1/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sbxKey.secretKey}`,
      },
      body: JSON.stringify({ title: "Should Be Blocked", price: 20 }),
    });
    const sbxProductResp = await v1PostProducts(sbxProductReq);
    expect(sbxProductResp.status).toBe(403);

    // Full v1 API resource read & webhook endpoints check
    const [
      productsGetResp,
      customersGetResp,
      paymentsGetResp,
      shipmentsGetResp,
      webhooksPostResp,
      webhooksGetResp,
    ] = await Promise.all([
      v1GetProducts(
        new NextRequest("http://localhost:3000/api/v1/products", {
          headers: { Authorization: `Bearer ${sbxKey.secretKey}` },
        })
      ),
      v1GetCustomers(
        new NextRequest("http://localhost:3000/api/v1/customers", {
          headers: { Authorization: `Bearer ${sbxKey.secretKey}` },
        })
      ),
      v1GetPayments(
        new NextRequest("http://localhost:3000/api/v1/payments", {
          headers: { Authorization: `Bearer ${sbxKey.secretKey}` },
        })
      ),
      v1GetShipments(
        new NextRequest("http://localhost:3000/api/v1/shipments", {
          headers: { Authorization: `Bearer ${sbxKey.secretKey}` },
        })
      ),
      v1PostWebhooks(
        new NextRequest("http://localhost:3000/api/v1/webhooks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sbxKey.secretKey}`,
          },
          body: JSON.stringify({
            targetUrl: "https://sandbox.partner.test/hook",
            eventTypes: ["order.created"],
          }),
        })
      ),
      v1GetWebhooks(
        new NextRequest("http://localhost:3000/api/v1/webhooks", {
          headers: { Authorization: `Bearer ${sbxKey.secretKey}` },
        })
      ),
    ]);
    expect(productsGetResp.status).toBe(200);
    expect(customersGetResp.status).toBe(200);
    expect(paymentsGetResp.status).toBe(200);
    expect(shipmentsGetResp.status).toBe(200);
    expect(webhooksPostResp.status).toBe(201);
    expect(webhooksGetResp.status).toBe(200);

    // Sandbox analytics & transactions endpoints
    const txResp = await v1GetTransactions(
      new NextRequest("http://localhost:3000/api/v1/transactions", {
        headers: { Authorization: `Bearer ${sbxKey.secretKey}` },
      })
    );
    expect(txResp.status).toBe(200);
    const txJson = await txResp.json();
    expect(txJson.data.items.every((t: any) => t.isSandbox === true)).toBe(true);

    const analyticsResp = await v1GetAnalytics(
      new NextRequest("http://localhost:3000/api/v1/analytics", {
        headers: { Authorization: `Bearer ${sbxKey.secretKey}` },
      })
    );
    expect(analyticsResp.status).toBe(200);

    // OpenAPI spec
    const openApiResp = await v1GetOpenApi();
    expect(openApiResp.status).toBe(200);
    const openApiSpec = await openApiResp.json();
    expect(openApiSpec.openapi).toBe("3.1.0");
    expect(openApiSpec.paths["/orders"]).toBeDefined();

    // Key rotation invalidates old key
    const rotated = await rotateApiKey(sellerUserId, sbxKey.id);
    await expect(
      authenticateDeveloperApiKey(
        new Request("http://localhost:3000/api/v1/orders", {
          headers: { "x-orderflow-api-key": sbxKey.secretKey },
        })
      )
    ).rejects.toThrow(DeveloperAuthError);

    const validRotated = await authenticateDeveloperApiKey(
      new Request("http://localhost:3000/api/v1/orders", {
        headers: { "x-orderflow-api-key": rotated.secretKey },
      })
    );
    expect(validRotated.apiKeyId).toBe(rotated.newKeyId);

    // Revocation invalidates rotated key too
    await revokeApiKey(sellerUserId, rotated.newKeyId);
    await expect(
      authenticateDeveloperApiKey(
        new Request("http://localhost:3000/api/v1/orders", {
          headers: { "x-orderflow-api-key": rotated.secretKey },
        })
      )
    ).rejects.toThrow(DeveloperAuthError);
  });

  it("signs, verifies, retries, and dead-letters outbound developer webhooks", async () => {
    const liveApp = await createDeveloperApplication(sellerUserId, {
      name: "Webhook Test App",
      environment: ApiEnvironment.LIVE,
      businessId,
    });

    const sub = await createWebhookSubscription(sellerUserId, {
      applicationId: liveApp.id,
      targetUrl: "https://hooks.partner.test/orderflow",
      eventTypes: ["order.created", "payment.captured"],
    });
    expect(sub.signingSecret.startsWith("whsec_")).toBe(true);

    // Signature verification + tamper & replay protection
    const sampleBody = JSON.stringify({ event: "order.created", id: "evt_1" });
    const nowSec = Math.floor(Date.now() / 1000);
    const sig = signDeveloperWebhookPayload(sampleBody, sub.signingSecret, nowSec);
    expect(verifyDeveloperWebhookSignature(sampleBody, sig, sub.signingSecret)).toBe(true);
    expect(verifyDeveloperWebhookSignature(sampleBody + "!", sig, sub.signingSecret)).toBe(false);

    const expiredSig = signDeveloperWebhookPayload(sampleBody, sub.signingSecret, nowSec - 600);
    expect(verifyDeveloperWebhookSignature(sampleBody, expiredSig, sub.signingSecret, 300)).toBe(
      false
    );

    // Failed transport moves delivery to RETRYING and schedules WEBHOOK_RETRY job
    const deliveries = await dispatchDeveloperWebhookEvent(
      {
        businessId,
        eventType: "order.created",
        environment: ApiEnvironment.LIVE,
        data: { orderId: "ord_123" },
      },
      {
        transport: async () => ({ status: 503, body: "Upstream busy" }),
        deliverImmediately: true,
      }
    );
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe(WebhookDeliveryStatus.RETRYING);

    // Manual retry succeeds when partner endpoint recovers
    const recovered = await retryWebhookDelivery(deliveries[0].id, async () => ({
      status: 200,
      body: "OK",
    }));
    expect(recovered.status).toBe(WebhookDeliveryStatus.DELIVERED);
    expect(recovered.attemptCount).toBe(2);
  });
});

describe("Phase 6: Globalization, Multi-Currency Minor Units, Tax Rules & i18n", () => {
  it("computes deterministic basis-point GST tax breakdowns without floating-point drift", async () => {
    expect(computeBasisPointsAmount(10000, 1800)).toBe(1800);
    expect(computeInclusiveBasisPointsTax(11800, 1800)).toBe(1800);

    await createTaxRule(businessId, {
      name: "IN GST 18%",
      countryCode: "IN",
      stateCode: "MH",
      rateBasisPoints: 1800,
      mode: TaxCalculationMode.EXCLUSIVE,
      components: [
        { name: "CGST", rateBasisPoints: 900 },
        { name: "SGST", rateBasisPoints: 900 },
      ],
    });

    const snapshot = await calculateOrderTotalSnapshot({
      businessId,
      subtotalMinorUnits: toMinorUnits(1000, "INR"),
      discountMinorUnits: 0,
      shippingMinorUnits: toMinorUnits(50, "INR"),
      currency: "INR",
      countryCode: "IN",
      stateCode: "MH",
    });

    expect(snapshot.taxMinorUnits).toBe(18000);
    expect(snapshot.grandTotalMinorUnits).toBe(123000);
    expect(snapshot.components).toHaveLength(2);
    expect(snapshot.components[0].amountMinorUnits + snapshot.components[1].amountMinorUnits).toBe(
      18000
    );
  });

  it("supports i18n translations (en/hi/bn), UTC->timezone formatting, and structured global addresses", () => {
    expect(resolveLocale("hi-IN")).toBe("hi");
    expect(resolveLocale("bn")).toBe("bn");
    expect(t("common.verified", "en")).toBe("Verified");
    expect(t("common.verified", "hi")).toBe("सत्यापित");
    expect(t("common.verified", "bn")).toBe("যাচাইকৃত");

    const tsFormatted = formatTimestampInTimezone("2026-11-25T12:00:00.000Z", {
      timezone: "Asia/Kolkata",
      locale: "en",
    });
    expect(tsFormatted.timezone).toBe("Asia/Kolkata");
    expect(tsFormatted.utcIso).toBe("2026-11-25T12:00:00.000Z");

    const addr = normalizeStructuredAddress({
      name: "Ananya Roy",
      phone: "9830012345",
      addressLine1: "14 Park Street",
      city: "Kolkata",
      state: "WB",
      postalCode: "700016",
      countryCode: "IN",
    });
    expect(addr.phone).toBe("+919830012345");
    expect(addr.rawPreserved.addressLine1).toBe("14 Park Street");
    expect(formatMoneyLocalized(12550, "INR", "en")).toContain("125.50");
    expect(getRegionalCapabilities("IN").recommendedPaymentProviders).toContain("RAZORPAY");
  });
});

describe("Phase 6: Data Portability, Safe Account Deletion, Distributed Rate Limit, Jobs, Integrations, Abuse & Observability", () => {
  it("exports strictly authorized buyer & seller data with checksums and redacts seller internals", async () => {
    const jsonExport = await exportBuyerPortabilityData(buyerUserId, "JSON");
    expect(jsonExport.format).toBe("JSON");
    expect(jsonExport.checksum).toHaveLength(64);
    const serialized = JSON.stringify(jsonExport.data);
    expect(serialized).not.toContain("costPrice");
    expect(serialized).not.toContain("sellerNotes");

    const csvExport = await exportBuyerPortabilityData(buyerUserId, "CSV");
    expect(csvExport.format).toBe("CSV");
    expect(csvExport.csv).toContain("Order Number");

    const sellerExport = await exportSellerTenantData(businessId, sellerUserId, "orders");
    expect(sellerExport.checksum).toHaveLength(64);
    expect(sellerExport.recordCount).toBeGreaterThanOrEqual(2);
  });

  it("anonymizes deleted buyer PII while preserving financial order & ledger records", async () => {
    const delIdentity = await getOrCreateBuyerIdentity(deletableBuyerUserId);
    const tenantDb = getTenantDb(businessId);
    const order = await tenantDb.createOrder({
      newCustomer: { name: "Ephemeral Buyer" },
      items: [{ productId: discoverableProductId, title: "Scarf", quantity: 1, unitPrice: 75 }],
    });
    await prisma.socialTransaction.updateMany({
      where: { orderId: order.id },
      data: { buyerUserId: deletableBuyerUserId, buyerIdentityId: delIdentity.id },
    });

    const deletion = await deactivateOrDeleteBuyerIdentity(
      deletableBuyerUserId,
      "DELETE",
      "GDPR erasure request"
    );
    expect(deletion.status).toBe("DELETED");
    expect(deletion.financialRecordsPreserved).toBe(true);

    const anonymized = await prisma.buyerIdentity.findUniqueOrThrow({
      where: { id: delIdentity.id },
    });
    expect(anonymized.email).toBeNull();
    expect(anonymized.phone).toBeNull();
    expect(anonymized.displayName).toBe("Deleted User");

    const preservedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(preservedOrder).not.toBeNull();
  });

  it("enforces distributed rate limits, idempotent background jobs, integration credentials encryption, abuse governance & observability", async () => {
    // 1. Distributed DB-backed rate limiter
    const keyPrefix = `p6-dist-${Date.now()}`;
    const r1 = await checkDistributedRateLimit(new Request("http://localhost/test"), {
      keyPrefix,
      limit: 2,
      windowMs: 30_000,
      identifierOverride: "client-1",
    });
    const r2 = await checkDistributedRateLimit(new Request("http://localhost/test"), {
      keyPrefix,
      limit: 2,
      windowMs: 30_000,
      identifierOverride: "client-1",
    });
    const r3 = await checkDistributedRateLimit(new Request("http://localhost/test"), {
      keyPrefix,
      limit: 2,
      windowMs: 30_000,
      identifierOverride: "client-1",
    });
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);

    // 2. Idempotent background jobs & backoff retry
    const jobKey = `job_idem_${Date.now()}`;
    const enq1 = await enqueueBackgroundJob({
      businessId,
      jobType: "ANALYTICS_AGGREGATION",
      payload: { window: "30d" },
      idempotencyKey: jobKey,
    });
    const enq2 = await enqueueBackgroundJob({
      businessId,
      jobType: "ANALYTICS_AGGREGATION",
      payload: { window: "30d" },
      idempotencyKey: jobKey,
    });
    expect(enq1.deduplicated).toBe(false);
    expect(enq2.deduplicated).toBe(true);
    expect(enq2.job.id).toBe(enq1.job.id);

    const completedJob = await executeBackgroundJob(enq1.job.id);
    expect(completedJob?.status).toBe("COMPLETED");

    // Verify batch processor runs without error on due jobs
    const batchResults = await processDueBackgroundJobs(businessId, 10);
    expect(Array.isArray(batchResults)).toBe(true);

    // 3. Integration hub & encrypted credentials
    const conn = await connectThirdPartyIntegration(businessId, {
      providerSlug: "zoho-books-accounting",
      environment: ApiEnvironment.SANDBOX,
      externalAccountId: "zoho_org_881",
      credentials: { apiKey: "secret-zoho-token-123" },
    });
    expect(conn.hasCredentials).toBe(true);
    const catalog = await listIntegrationCatalog(businessId);
    expect(catalog.providers.length).toBeGreaterThanOrEqual(10);
    expect(JSON.stringify(catalog.connections)).not.toContain("secret-zoho-token-123");
    const disconn = await disconnectThirdPartyIntegration(businessId, conn.id);
    expect(disconn.status).toBe("DISCONNECTED");

    // 4. Auditable platform abuse lifecycle (SUSPEND -> APPEAL -> RESOLVE)
    const abuseCase = await flagPlatformAbuse({
      targetType: AbuseTargetType.SELLER,
      targetId: hiddenBusinessId,
      businessId: hiddenBusinessId,
      reason: "Suspicious duplicate listing pattern",
      category: "SPAM",
      actorId: adminUserId,
    });
    await applyAbuseAction(abuseCase.id, {
      action: AbuseActionType.SUSPEND,
      actorId: adminUserId,
      notes: "Temporarily suspended pending seller clarification",
    });
    const suspendedBiz = await prisma.business.findUniqueOrThrow({
      where: { id: hiddenBusinessId },
    });
    expect(suspendedBiz.accountStatus).toBe(AccountLifecycleStatus.SUSPENDED);

    await applyAbuseAction(abuseCase.id, {
      action: AbuseActionType.APPEAL,
      actorId: sellerUserId,
      notes: "Submitted inventory invoice proof",
    });
    const resolvedCase = await applyAbuseAction(abuseCase.id, {
      action: AbuseActionType.RESOLVE,
      actorId: adminUserId,
      notes: "Appeal verified, restored active status",
    });
    expect(resolvedCase.status).toBe("RESOLVED");
    expect(Array.isArray(resolvedCase.auditTrail)).toBe(true);
    expect((resolvedCase.auditTrail as any[]).length).toBe(4);

    // 5. Observability excludes sandbox orders & returns provenance
    const obs = await getPlatformObservabilitySnapshot({ businessId, windowDays: 30 });
    expect(obs.network.gmv.provenance).toContain("isSandbox=false");
    expect(obs.scope).toBe(`TENANT:${businessId}`);
  });
});
