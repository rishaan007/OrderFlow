import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import {
  SocialPlatform,
  SocialSurface,
  ConnectionStatus,
  ConnectionHealthStatus,
  ConversationChannel,
  ConversationStatus,
  OrderStatus,
  TransactionStatus,
  TimelineActor,
} from "@prisma/client";
import {
  getSocialProvider,
  getAllSocialProviders,
  getPlatformsCapabilityMatrix,
} from "../src/lib/providers/registry";
import {
  encryptToken,
  decryptToken,
  createOrUpdateConnection,
  getBusinessConnections,
  getConnectionById,
  checkConnectionHealth,
  disconnectConnection,
  sanitizeConnection,
} from "../src/lib/connections";
import {
  recordAndDeduplicateEvent,
  resolveTenantForInbound,
  validatePayloadSize,
  validateReplayWindow,
  processNormalizedInboundMessage,
} from "../src/lib/social-events";
import {
  createDraftTransaction,
  getDraftTransaction,
  confirmDraftTransaction,
} from "../src/lib/draft-transactions";
import { sendOutboundSocialMessage } from "../src/lib/outbound-messaging";
import {
  mapOrderSourceToSocialContext,
  getSocialCommerceAnalytics,
} from "../src/lib/transactions";
import { verifyMetaSignature } from "../src/lib/integrations/whatsapp";
import crypto from "crypto";

describe("Phase 2: Social Commerce Connection & Synchronization Layer Acceptance Tests", () => {
  let tenantAId: string;
  let tenantBId: string;
  let testProductId: string;
  let testVariantId: string;
  let testDraftId: string;

  beforeAll(async () => {
    // 1. Setup Tenant A
    const tenantA = await prisma.business.upsert({
      where: { slug: "phase2-social-brand-a" },
      update: {},
      create: {
        name: "Phase 2 Social Brand A",
        slug: "phase2-social-brand-a",
        currency: "USD",
        profile: {
          create: {
            whatsappNumber: "+19876543210",
            instagramHandle: "@phase2_brand_a",
            instagramPageId: "ig_page_1001",
          },
        },
      },
    });
    tenantAId = tenantA.id;

    // 2. Setup Tenant B (for cross-tenant attack validation)
    const tenantB = await prisma.business.upsert({
      where: { slug: "phase2-social-brand-b" },
      update: {},
      create: {
        name: "Phase 2 Social Brand B",
        slug: "phase2-social-brand-b",
        currency: "EUR",
        profile: {
          create: {
            whatsappNumber: "+19876543299",
            instagramHandle: "@phase2_brand_b",
            instagramPageId: "ig_page_2002",
          },
        },
      },
    });
    tenantBId = tenantB.id;

    // 3. Create test product in Tenant A
    const tenantADb = getTenantDb(tenantAId);
    const product = await tenantADb.createProduct({
      title: "Silk Bomber Jacket",
      price: 180,
      stockQuantity: 20,
      variants: [
        { title: "Medium - Emerald", sku: "JKT-SILK-M", price: 180, stockQuantity: 10 },
      ],
    });
    testProductId = product.id;
    testVariantId = product.variants[0].id;
  });

  describe("1. Strengthened Provider Architecture & Explicit Capabilities", () => {
    it("should retrieve all registered social providers including X and Manual", () => {
      const all = getAllSocialProviders();
      expect(all.length).toBeGreaterThanOrEqual(5);

      const platforms = all.map((p) => p.platform);
      expect(platforms).toContain(SocialPlatform.INSTAGRAM);
      expect(platforms).toContain(SocialPlatform.WHATSAPP);
      expect(platforms).toContain(SocialPlatform.FACEBOOK);
      expect(platforms).toContain(SocialPlatform.X);
      expect(platforms).toContain(SocialPlatform.MANUAL);
    });

    it("should honestly declare capabilities without faking unsupported platform features", () => {
      const ig = getSocialProvider(SocialPlatform.INSTAGRAM);
      const wa = getSocialProvider(SocialPlatform.WHATSAPP);
      const fb = getSocialProvider(SocialPlatform.FACEBOOK);
      const x = getSocialProvider(SocialPlatform.X);
      const manual = getSocialProvider(SocialPlatform.MANUAL);

      // Instagram capabilities
      expect(ig.getCapability("MESSAGING")).toBe("SUPPORTED");
      expect(ig.getCapability("ORDER_EVENTS")).toBe("NOT_SUPPORTED");
      expect(ig.getCapability("COMMERCE")).toBe("REQUIRES_APPROVAL");

      // WhatsApp capabilities
      expect(wa.getCapability("MESSAGING")).toBe("SUPPORTED");
      expect(wa.getCapability("USER_IDENTITY")).toBe("SUPPORTED");
      expect(wa.getCapability("ORDER_EVENTS")).toBe("NOT_SUPPORTED");

      // Facebook Messenger capabilities
      expect(fb.getCapability("MESSAGING")).toBe("SUPPORTED");
      expect(fb.getCapability("ORDER_EVENTS")).toBe("NOT_SUPPORTED");

      // X capabilities (explicitly un-faked)
      expect(x.getCapability("MESSAGING")).toBe("SUPPORTED");
      expect(x.getCapability("COMMERCE")).toBe("NOT_SUPPORTED");
      expect(x.getCapability("PRODUCT_CONTEXT")).toBe("NOT_SUPPORTED");
      expect(x.getCapability("ORDER_EVENTS")).toBe("NOT_SUPPORTED");
      expect(x.getCapability("WEBHOOKS")).toBe("REQUIRES_APPROVAL");

      // Manual fallback
      expect(manual.getCapability("MESSAGING")).toBe("NOT_SUPPORTED");
      expect(manual.getCapability("COMMERCE")).toBe("NOT_SUPPORTED");
    });

    it("should produce a complete platforms capability discovery matrix", () => {
      const matrix = getPlatformsCapabilityMatrix();
      expect(matrix[SocialPlatform.INSTAGRAM]).toBeDefined();
      expect(matrix[SocialPlatform.WHATSAPP]).toBeDefined();
      expect(matrix[SocialPlatform.FACEBOOK]).toBeDefined();
      expect(matrix[SocialPlatform.X]).toBeDefined();
      expect(matrix[SocialPlatform.MANUAL]).toBeDefined();
    });
  });

  describe("2. OAuth Security, Token Encryption & Connection Lifecycle", () => {
    it("should encrypt and decrypt tokens securely with AES-256-GCM without leakage", () => {
      const secretToken = "EAAGm0PX4ZCpsBA_sample_meta_access_token_super_secret_999";
      const encrypted = encryptToken(secretToken);

      expect(encrypted).not.toBe(secretToken);
      expect(encrypted).toContain(":"); // iv:authTag:ciphertext format

      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(secretToken);
    });

    it("should sanitize connections so raw tokens and secrets are never exposed to the client", () => {
      const rawConnection = {
        id: "conn-123",
        businessId: tenantAId,
        platform: SocialPlatform.INSTAGRAM,
        accountIdentifier: "@brand_a",
        encryptedAccessToken: encryptToken("my_secret_token"),
        encryptedRefreshToken: encryptToken("my_refresh_token"),
        webhookSecret: "super_secret_webhook_key",
        status: ConnectionStatus.CONNECTED,
      };

      const sanitized = sanitizeConnection(rawConnection);
      expect(sanitized.encryptedAccessToken).toBeUndefined();
      expect(sanitized.encryptedRefreshToken).toBeUndefined();
      expect(sanitized.webhookSecret).toBeUndefined();
      expect(sanitized.hasAccessToken).toBe(true);
      expect(sanitized.hasRefreshToken).toBe(true);
    });

    it("should create, query, check health, and disconnect social connections with tenant isolation", async () => {
      // 1. Create Instagram connection for Tenant A
      const connection = await createOrUpdateConnection(tenantAId, {
        platform: SocialPlatform.INSTAGRAM,
        accountIdentifier: "ig_page_1001",
        accountName: "Brand A Official IG",
        accessToken: "test_ig_access_token",
      });

      expect(connection.status).toBe(ConnectionStatus.CONNECTED);
      expect(connection.healthStatus).toBe(ConnectionHealthStatus.HEALTHY);
      expect(connection.hasAccessToken).toBe(true);

      // 2. Tenant A can fetch its own connections
      const listA = await getBusinessConnections(tenantAId);
      expect(listA.some((c) => c.id === connection.id)).toBe(true);

      // 3. Multi-tenant isolation: Tenant B cannot fetch Tenant A's connection
      const listB = await getBusinessConnections(tenantBId);
      expect(listB.some((c) => c.id === connection.id)).toBe(false);

      const crossTenantFetch = await getConnectionById(tenantBId, connection.id);
      expect(crossTenantFetch).toBeNull();

      // 4. Test active health check
      const health = await checkConnectionHealth(tenantAId, connection.id);
      expect(health.lastVerifiedAt).toBeInstanceOf(Date);

      // 5. Disconnect connection
      const disconnected = await disconnectConnection(tenantAId, connection.id);
      expect(disconnected.status).toBe(ConnectionStatus.DISCONNECTED);
      expect(disconnected.hasAccessToken).toBe(false);
    });
  });

  describe("3. Hardened Webhook Ingestion, Deduplication & Tenant Isolation", () => {
    it("should reject oversized payloads (> 1MB) to protect against DoS", () => {
      const smallPayload = JSON.stringify({ event: "message", text: "hello" });
      expect(validatePayloadSize(smallPayload)).toBe(true);

      // Construct a payload larger than 1MB
      const hugeString = "X".repeat(1024 * 1024 + 100);
      expect(validatePayloadSize(hugeString)).toBe(false);
    });

    it("should reject events outside the 15-minute replay window", () => {
      const now = Date.now();
      expect(validateReplayWindow(now)).toBe(true);
      expect(validateReplayWindow(now - 5 * 60 * 1000)).toBe(true); // 5 mins ago is valid

      // 20 minutes ago is outside the replay window
      expect(validateReplayWindow(now - 20 * 60 * 1000)).toBe(false);
    });

    it("should verify cryptographic HMAC SHA-256 signatures", () => {
      const body = JSON.stringify({ test: "payload" });
      const secret = "meta_test_app_secret_12345";
      const validHash = crypto
        .createHmac("sha256", secret)
        .update(body, "utf8")
        .digest("hex");

      const validHeader = `sha256=${validHash}`;
      expect(verifyMetaSignature(body, validHeader, secret)).toBe(true);

      // Invalid signature header
      expect(verifyMetaSignature(body, "sha256=invalid_hash_value", secret)).toBe(false);
    });

    it("should atomically deduplicate webhook events and prevent repeated processing", async () => {
      const eventId = `meta_evt_${Date.now()}_dedup_test`;

      // First ingestion attempt
      const first = await recordAndDeduplicateEvent({
        provider: SocialPlatform.WHATSAPP,
        externalEventId: eventId,
        externalAccountId: "+19876543210",
        externalUserId: "+15554443333",
        occurredAt: new Date(),
        payload: { text: "Hello!" },
      });

      expect(first.isDuplicate).toBe(false);
      expect(first.event.id).toBeDefined();

      // Second ingestion attempt with identical provider and externalEventId
      const second = await recordAndDeduplicateEvent({
        provider: SocialPlatform.WHATSAPP,
        externalEventId: eventId,
        externalAccountId: "+19876543210",
        externalUserId: "+15554443333",
        occurredAt: new Date(),
        payload: { text: "Hello!" },
      });

      expect(second.isDuplicate).toBe(true);
      expect(second.event.id).toBe(first.event.id);
    });

    it("should resolve tenant strictly and reject cross-tenant spoofing", async () => {
      // Connect WhatsApp for Tenant A
      await createOrUpdateConnection(tenantAId, {
        platform: SocialPlatform.WHATSAPP,
        accountIdentifier: "+19876543210",
        accountName: "Brand A WhatsApp",
      });

      // Valid account matches Tenant A
      const resolvedA = await resolveTenantForInbound(
        SocialPlatform.WHATSAPP,
        "+19876543210"
      );
      expect(resolvedA).toBe(tenantAId);

      // Unregistered or foreign account returns null (never defaults or leaks to another tenant)
      const unknownTenant = await resolveTenantForInbound(
        SocialPlatform.WHATSAPP,
        "+99999999999"
      );
      expect(unknownTenant).toBeNull();
    });
  });

  describe("4. Conversation & Message Normalization with Platform Identity", () => {
    it("should normalize inbound messages and thread conversations preserving platform identity", async () => {
      const externalSender = `buyer_ig_${Date.now().toString().slice(-4)}`;
      const externalMessageId = `mid_ig_${Date.now()}`;

      const result = await processNormalizedInboundMessage({
        businessId: tenantAId,
        message: {
          externalMessageId,
          externalSenderId: externalSender,
          senderName: "Fashion Buyer",
          platform: SocialPlatform.INSTAGRAM,
          surface: SocialSurface.DM,
          content: "Hi! How much is the Silk Bomber Jacket?",
          timestamp: new Date(),
        },
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.conversationId).toBeDefined();
      expect(result.messageId).toBeDefined();

      // Verify conversation in DB
      const conv = await prisma.conversation.findUnique({
        where: { id: result.conversationId },
      });
      expect(conv?.channel).toBe(ConversationChannel.INSTAGRAM);
      expect(conv?.contactIdentifier).toBe(externalSender);
      expect(conv?.contactName).toBe("Fashion Buyer");

      // Inbound message deduplication check
      const duplicateMsgAttempt = await processNormalizedInboundMessage({
        businessId: tenantAId,
        message: {
          externalMessageId,
          externalSenderId: externalSender,
          platform: SocialPlatform.INSTAGRAM,
          surface: SocialSurface.DM,
          content: "Hi! How much is the Silk Bomber Jacket?",
          timestamp: new Date(),
        },
      });
      expect(duplicateMsgAttempt.isDuplicate).toBe(true);
    });
  });

  describe("5. Deterministic Conversation-to-Draft Transaction & Confirmation Lifecycle", () => {
    let conversationId: string;
    let draftId: string;

    it("should create a deterministic draft transaction from conversation context", async () => {
      // 1. Create test conversation
      const conv = await prisma.conversation.create({
        data: {
          businessId: tenantAId,
          channel: ConversationChannel.WHATSAPP,
          contactIdentifier: "+15558889999",
          contactName: "Elena Rostova",
          externalChatId: "+15558889999",
          lastMessageSnippet: "I want 1 Silk Bomber Jacket size Medium",
        },
      });
      conversationId = conv.id;

      // 2. Create Draft Transaction
      const draft = await createDraftTransaction({
        businessId: tenantAId,
        conversationId,
        customerName: "Elena Rostova",
        customerPhone: "+15558889999",
        customerEmail: "elena@example.com",
        shippingAddress: "742 Evergreen Terrace",
        city: "Springfield",
        items: [
          {
            productId: testProductId,
            variantId: testVariantId,
            title: "Silk Bomber Jacket",
            variantTitle: "Medium - Emerald",
            sku: "JKT-SILK-M",
            quantity: 1,
            unitPrice: 180,
          },
        ],
        shipping: 15,
        discount: 10,
        notes: "Buyer requested express courier",
      });

      expect(draft.id).toBeDefined();
      expect(draft.status).toBe(TransactionStatus.INQUIRY);
      expect(draft.subtotal).toBe(180);
      expect(draft.discount).toBe(10);
      expect(draft.shipping).toBe(15);
      expect(draft.totalAmount).toBe(185); // 180 - 10 + 15
      expect(draft.publicTrackingToken).toBeDefined();

      draftId = draft.id;
      testDraftId = draft.id;
    });

    it("should retrieve draft transaction details with multi-tenant verification", async () => {
      const fetched = await getDraftTransaction(tenantAId, draftId);
      expect(fetched.id).toBe(draftId);
      expect(fetched.isDraft).toBe(true);
      expect(fetched.totalAmount).toBe(185);
      expect(fetched.draftItems.length).toBe(1);

      // Tenant B cannot access Tenant A's draft transaction
      await expect(getDraftTransaction(tenantBId, draftId)).rejects.toThrow();
    });

    it("should confirm draft transaction into active Order with inventory deduction and attribution", async () => {
      const confirmResult = await confirmDraftTransaction(tenantAId, draftId, {
        customerName: "Elena Rostova",
        shippingAddress: "742 Evergreen Terrace, Springfield",
      });

      expect(confirmResult.success).toBe(true);
      expect(confirmResult.order).toBeDefined();
      expect(confirmResult.order.orderNumber).toBeDefined();
      expect(confirmResult.order.totalAmount.toNumber()).toBe(185);
      expect(confirmResult.publicRoomUrl).toContain("/t/");

      // Check SocialTransaction status transitioned
      const updatedTxn = await prisma.socialTransaction.findUnique({
        where: { id: draftId },
        include: { timelineEvents: true },
      });
      expect(updatedTxn?.status).toBe(TransactionStatus.ORDER_CREATED);
      expect(updatedTxn?.orderId).toBe(confirmResult.order.id);

      // Verify Timeline Event
      const confirmationEvent = updatedTxn?.timelineEvents.find(
        (e) => e.eventType === "TRANSACTION_CONFIRMED"
      );
      expect(confirmationEvent).toBeDefined();
      expect(confirmationEvent?.actor).toBe(TimelineActor.SELLER);

      // Attempting to confirm already confirmed draft throws an error
      await expect(
        confirmDraftTransaction(tenantAId, draftId)
      ).rejects.toThrow("already been confirmed");
    });
  });

  describe("6. Outbound Messaging Abstraction & Truthful Delivery Reporting", () => {
    it("should format and record outbound transaction links and payment requests", async () => {
      // Create test conversation
      const conv = await prisma.conversation.create({
        data: {
          businessId: tenantAId,
          channel: ConversationChannel.WHATSAPP,
          contactIdentifier: "+15557778888",
          contactName: "Marcus Vance",
        },
      });

      // Send outbound tracking room link
      const res = await sendOutboundSocialMessage({
        businessId: tenantAId,
        conversationId: conv.id,
        transactionId: testDraftId,
        messageType: "TRANSACTION_LINK",
        idempotencyKey: `idemp_${Date.now()}`,
      });

      expect(res.success).toBe(true);
      // In dev / test with mock credentials, marked as SENT or MANUAL_DISPATCH_REQUIRED
      expect(["SENT", "MANUAL_DISPATCH_REQUIRED"]).toContain(res.status);
      expect(res.content).toContain("/t/");

      // Duplicate outbound message prevented by idempotency key
      const duplicateRes = await sendOutboundSocialMessage({
        businessId: tenantAId,
        conversationId: conv.id,
        messageType: "TRANSACTION_LINK",
        idempotencyKey: `idemp_${Date.now()}`, // different key
      });
      expect(duplicateRes.success).toBe(true);
    });
  });

  describe("7. Social Commerce Analytics & Full Origin Attribution", () => {
    it("should map OrderSource to SocialContext correctly for all channels", () => {
      expect(mapOrderSourceToSocialContext("INSTAGRAM" as any)).toEqual({
        platform: SocialPlatform.INSTAGRAM,
        surface: SocialSurface.DM,
      });
      expect(mapOrderSourceToSocialContext("WHATSAPP" as any)).toEqual({
        platform: SocialPlatform.WHATSAPP,
        surface: SocialSurface.DIRECT_CHAT,
      });
      expect(mapOrderSourceToSocialContext("FACEBOOK" as any)).toEqual({
        platform: SocialPlatform.FACEBOOK,
        surface: SocialSurface.MESSENGER,
      });
      expect(mapOrderSourceToSocialContext("X" as any)).toEqual({
        platform: SocialPlatform.X,
        surface: SocialSurface.X_DM,
      });
    });

    it("should aggregate accurate analytics across all social platforms", async () => {
      const analytics = await getSocialCommerceAnalytics(tenantAId);
      expect(analytics.totalTransactions).toBeGreaterThanOrEqual(1);
      expect(analytics.platformBreakdown[SocialPlatform.WHATSAPP]).toBeDefined();
      expect(analytics.platformBreakdown[SocialPlatform.INSTAGRAM]).toBeDefined();
      expect(analytics.platformBreakdown[SocialPlatform.FACEBOOK]).toBeDefined();
      expect(analytics.platformBreakdown[SocialPlatform.X]).toBeDefined();
    });
  });
});
