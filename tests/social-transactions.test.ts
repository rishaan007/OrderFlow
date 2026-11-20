import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import {
  createSocialTransaction,
  getSocialTransactionById,
  addTimelineEvent,
  addEvidence,
  getPublicTransactionByToken,
  createPublicDispute,
  updateDisputeStatus,
  getSellerTrustMetrics,
  getSocialCommerceAnalytics,
} from "../src/lib/transactions";
import {
  getSocialProvider,
  getAllSocialProviders,
} from "../src/lib/providers/registry";
import { classifySocialIntent } from "../src/lib/order-extraction";
import {
  SocialPlatform,
  SocialSurface,
  TransactionStatus,
  TimelineVisibility,
  TimelineActor,
  EvidenceType,
  PaymentMethod,
  PaymentRecordStatus,
} from "@prisma/client";

let testBusinessId: string;
let tenant: ReturnType<typeof getTenantDb>;

beforeAll(async () => {
  const business = await prisma.business.findFirst({
    include: { profile: true },
  });
  if (!business) throw new Error("No test business found in database");
  testBusinessId = business.id;
  tenant = getTenantDb(testBusinessId);
});

describe("Social Commerce & Transaction Operating System", () => {
  describe("1. Canonical SocialTransaction Entity Creation & Relations", () => {
    it("should create a canonical SocialTransaction with platform, surface, and automatic initial timeline event", async () => {
      const transaction = await createSocialTransaction(testBusinessId, {
        platform: SocialPlatform.INSTAGRAM,
        surface: SocialSurface.DM,
        status: TransactionStatus.INQUIRY,
        externalUserId: "ig_user_9921",
        externalConversationId: "ig_thread_441",
        buyerNotes: "Inquired about blue sweater size M",
        sellerNotes: "Private internal note: high intent buyer",
      });

      expect(transaction.id).toBeDefined();
      expect(transaction.platform).toBe(SocialPlatform.INSTAGRAM);
      expect(transaction.surface).toBe(SocialSurface.DM);
      expect(transaction.publicTrackingToken).toBeDefined();
      expect(transaction.publicTrackingToken.length).toBeGreaterThan(10);

      // Verify initial timeline event was auto-created
      const full = await getSocialTransactionById(testBusinessId, transaction.id);
      expect(full.timelineEvents.length).toBeGreaterThanOrEqual(1);
      expect(full.timelineEvents[0].eventType).toBe("TRANSACTION_INITIALIZED");
      expect(full.timelineEvents[0].visibility).toBe(TimelineVisibility.PUBLIC);
    });

    it("should automatically link a SocialTransaction and timeline event when an order is created", async () => {
      const order = await tenant.createOrder({
        source: "WHATSAPP" as any,
        notes: "WhatsApp direct chat order",
        items: [
          {
            title: "Vintage Denim Jacket",
            quantity: 1,
            unitPrice: 85,
          },
        ],
      });

      expect(order.id).toBeDefined();

      const linkedTx = await prisma.socialTransaction.findUnique({
        where: { orderId: order.id },
        include: { timelineEvents: true, evidence: true },
      });

      expect(linkedTx).not.toBeNull();
      expect(linkedTx?.platform).toBe(SocialPlatform.WHATSAPP);
      expect(linkedTx?.surface).toBe(SocialSurface.DIRECT_CHAT);
      expect(linkedTx?.status).toBe(TransactionStatus.ORDER_CREATED);
      expect(linkedTx?.timelineEvents.some((e) => e.eventType === "ORDER_CREATED")).toBe(true);
      expect(linkedTx?.evidence.some((e) => e.evidenceType === EvidenceType.ORDER_CONFIRMATION)).toBe(true);
    });
  });

  describe("2. Cryptographic Evidence & Timeline Lifecycle Progression", () => {
    it("should record verified payment evidence and timeline progression", async () => {
      // 1. Create order
      const order = await tenant.createOrder({
        source: "INSTAGRAM" as any,
        items: [{ title: "Silk Scarf", quantity: 1, unitPrice: 50 }],
      });

      // 2. Record pending payment
      const payment = await tenant.recordPayment(order.id, {
        amount: 50,
        method: PaymentMethod.UPI,
        referenceNumber: "UPI-TEST-999",
      });

      // 3. Verify payment
      await tenant.verifyPayment(payment.id, { action: "VERIFY" });

      // 4. Inspect SocialTransaction
      const socialTx = await prisma.socialTransaction.findUnique({
        where: { orderId: order.id },
        include: { timelineEvents: true, evidence: true },
      });

      expect(socialTx?.status).toBe(TransactionStatus.PAYMENT_VERIFIED);
      expect(socialTx?.timelineEvents.some((e) => e.eventType === "PAYMENT_VERIFIED")).toBe(true);
      expect(socialTx?.evidence.some((e) => e.evidenceType === EvidenceType.PAYMENT_VERIFICATION)).toBe(true);
    });

    it("should record shipment tracking evidence and timeline dispatch event", async () => {
      const order = await tenant.createOrder({
        source: "MANUAL" as any,
        items: [{ title: "Leather Boots", quantity: 1, unitPrice: 120 }],
      });

      const shipment = await tenant.createShipment(order.id, {
        carrier: "BLUEDART" as any,
        trackingNumber: "BD-AWB-883719",
        trackingUrl: "https://bluedart.com/track/883719",
      });

      expect(shipment.id).toBeDefined();

      const socialTx = await prisma.socialTransaction.findUnique({
        where: { orderId: order.id },
        include: { timelineEvents: true, evidence: true },
      });

      expect(socialTx?.status).toBe(TransactionStatus.DISPATCHED);
      expect(socialTx?.timelineEvents.some((e) => e.eventType === "SHIPMENT_DISPATCHED")).toBe(true);
      expect(socialTx?.evidence.some((e) => e.evidenceType === EvidenceType.CARRIER_TRACKING)).toBe(true);
    });
  });

  describe("3. Buyer-Safe Public Projection & Security Sandbox (/t/[token])", () => {
    it("should strictly sanitize public room data and hide internal seller notes and private margins", async () => {
      // Create transaction with internal seller notes and internal timeline event
      const tx = await createSocialTransaction(testBusinessId, {
        platform: SocialPlatform.INSTAGRAM,
        surface: SocialSurface.DM,
        buyerNotes: "Public customer instructions: please ring doorbell",
        sellerNotes: "INTERNAL SECRET: Wholesale cost $20, margin 75%",
      });

      // Add an internal-only timeline event
      await addTimelineEvent(testBusinessId, tx.id, {
        eventType: "INTERNAL_FRAUD_CHECK",
        title: "Internal Risk Analysis Passed",
        description: "Seller internal fraud scoring 0.02 (safe)",
        actor: TimelineActor.SYSTEM,
        visibility: TimelineVisibility.INTERNAL_ONLY,
      });

      // Add a public timeline event
      await addTimelineEvent(testBusinessId, tx.id, {
        eventType: "PACKAGING_COMPLETE",
        title: "Item Prepared & Packed",
        description: "Order carefully packaged with eco-friendly wrap",
        actor: TimelineActor.SELLER,
        visibility: TimelineVisibility.PUBLIC,
      });

      // Fetch public projection
      const publicData = await getPublicTransactionByToken(tx.publicTrackingToken);

      expect(publicData).not.toBeNull();
      // Internal sellerNotes MUST NOT be in public schema
      expect((publicData as any).sellerNotes).toBeUndefined();
      // Internal-only timeline event MUST NOT be visible to buyer
      const hasInternalEvent = publicData?.timeline.some(
        (e) => e.title.includes("Internal Risk") || e.description?.includes("margin")
      );
      expect(hasInternalEvent).toBe(false);

      // Public timeline event MUST be present
      const hasPublicEvent = publicData?.timeline.some((e) => e.title === "Item Prepared & Packed");
      expect(hasPublicEvent).toBe(true);

      // Seller Trust profile must be present
      expect(publicData?.seller.name).toBeDefined();
      expect(publicData?.seller.metrics).toBeDefined();
      expect(publicData?.seller.metrics?.deliveryFulfillmentRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe("4. Return / Refund / Dispute Lifecycle", () => {
    it("should allow a buyer to raise a dispute from public tracking token and seller to approve/refund", async () => {
      const tx = await createSocialTransaction(testBusinessId, {
        platform: SocialPlatform.WHATSAPP,
        surface: SocialSurface.DIRECT_CHAT,
        status: TransactionStatus.DELIVERED,
      });

      // 1. Buyer raises dispute via public token
      const dispute = await createPublicDispute(tx.publicTrackingToken, {
        reason: "Item delivered has torn fabric",
        buyerNotes: "See attached photos",
        evidenceUrls: ["https://cdn.orderflow.io/disputes/proof1.jpg"],
      });

      expect(dispute.id).toBeDefined();
      expect(dispute.status).toBe("REQUESTED");

      // Verify transaction status changed to DISPUTED
      const updatedTx = await prisma.socialTransaction.findUnique({
        where: { id: tx.id },
      });
      expect(updatedTx?.status).toBe(TransactionStatus.DISPUTED);

      // 2. Seller approves and resolves dispute with refund
      const resolved = await updateDisputeStatus(testBusinessId, dispute.id, {
        status: "REFUNDED",
        sellerResponse: "Refund of $50 issued to original payment method",
        resolutionNotes: "Customer return accepted",
        refundAmount: 50,
      });

      expect(resolved.status).toBe("REFUNDED");
      expect(resolved.resolvedAt).toBeDefined();

      const finalTx = await prisma.socialTransaction.findUnique({
        where: { id: tx.id },
      });
      expect(finalTx?.status).toBe(TransactionStatus.REFUNDED);
    });
  });

  describe("5. Social Commerce Provider Abstraction & Capabilities", () => {
    it("should declare explicit capabilities without faking unsupported public APIs", () => {
      const ig = getSocialProvider(SocialPlatform.INSTAGRAM);
      const wa = getSocialProvider(SocialPlatform.WHATSAPP);
      const manual = getSocialProvider(SocialPlatform.MANUAL);

      expect(ig.platform).toBe(SocialPlatform.INSTAGRAM);
      expect(wa.platform).toBe(SocialPlatform.WHATSAPP);

      const igCaps = ig.getCapabilities();
      expect(igCaps.messaging).toBe(true);
      expect(igCaps.storyMentions).toBe(true);
      // Realistic API boundaries: Instagram Public API does not provide automatic carrier delivery receipts
      expect(igCaps.orderStatusWebhook).toBe(false);

      const waCaps = wa.getCapabilities();
      expect(waCaps.messaging).toBe(true);
      expect(waCaps.storyMentions).toBe(false); // WhatsApp status has no 3rd-party webhook

      const manualCaps = manual.getCapabilities();
      expect(manualCaps.messaging).toBe(false);
      expect(manualCaps.directCheckout).toBe(false);

      // All registered providers
      const all = getAllSocialProviders();
      expect(all.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("6. AI Social Intent & Entity Classification", () => {
    it("should classify BUYING_INTENT with address entity extraction", () => {
      const messages = [
        { senderType: "CUSTOMER" as const, content: "Hello! I want to buy 2 sweaters. Please deliver to 45 Park Ave, New York" },
      ];
      const classification = classifySocialIntent(messages);
      expect(classification.primaryIntent).toBe("BUYING_INTENT");
      expect(classification.confidence).toBeGreaterThanOrEqual(0.85);
      expect(classification.extractedEntities.address).toContain("Park Ave");
    });

    it("should classify PAYMENT_SENT upon receipt of UTR or payment proof", () => {
      const messages = [
        { senderType: "CUSTOMER" as const, content: "Payment done! UTR ref: 998273612344" },
      ];
      const classification = classifySocialIntent(messages);
      expect(classification.primaryIntent).toBe("PAYMENT_SENT");
      expect(classification.confidence).toBeGreaterThan(0.9);
      expect(classification.extractedEntities.paymentReference).toBe("998273612344");
    });

    it("should classify RETURN_REQUEST and flag missing reason/evidence", () => {
      const messages = [
        { senderType: "CUSTOMER" as const, content: "I need to return this dress, it is damaged" },
      ];
      const classification = classifySocialIntent(messages);
      expect(classification.primaryIntent).toBe("RETURN_REQUEST");
      expect(classification.missingFields).toContain("evidence");
    });
  });

  describe("7. Social Commerce Analytics Aggregation", () => {
    it("should aggregate multi-channel transaction counts and revenue", async () => {
      const analytics = await getSocialCommerceAnalytics(testBusinessId);
      expect(analytics.totalTransactions).toBeGreaterThanOrEqual(1);
      expect(analytics.platformBreakdown).toBeDefined();
      expect(analytics.platformBreakdown.INSTAGRAM).toBeDefined();
      expect(analytics.platformBreakdown.WHATSAPP).toBeDefined();
    });
  });
});
