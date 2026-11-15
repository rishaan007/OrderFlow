import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import {
  ConversationChannel,
  ConversationStatus,
  MessageSenderType,
  OrderStatus,
  ProductStatus,
} from "@prisma/client";
import {
  verifyWhatsAppWebhookSubscription,
  parseWhatsAppWebhook,
} from "../src/lib/integrations/whatsapp";
import {
  verifyInstagramWebhookSubscription,
  parseInstagramWebhook,
} from "../src/lib/integrations/instagram";

describe("Phase 3: Unified Inbox & Conversation-to-Order Acceptance Tests", () => {
  let tenantAId: string;
  let tenantBId: string;
  let tenantADb: ReturnType<typeof getTenantDb>;
  let tenantBDb: ReturnType<typeof getTenantDb>;

  let cashmereSweaterId: string;
  let mediumVariantId: string;
  let largeVariantId: string;
  let silkScarfId: string;

  beforeAll(async () => {
    // 1. Setup Tenant A
    const tenantA = await prisma.business.upsert({
      where: { slug: "inbox-atelier-a" },
      update: {},
      create: {
        name: "Inbox Atelier A",
        slug: "inbox-atelier-a",
        currency: "USD",
        profile: {
          create: {
            whatsappNumber: "+15551234567",
            instagramHandle: "@inbox_atelier_a",
            orderPrefix: "ATELIER-",
            autoConfirmOrders: false,
          },
        },
      },
    });
    tenantAId = tenantA.id;
    tenantADb = getTenantDb(tenantAId);

    // 2. Setup Tenant B
    const tenantB = await prisma.business.upsert({
      where: { slug: "inbox-boutique-b" },
      update: {},
      create: {
        name: "Inbox Boutique B",
        slug: "inbox-boutique-b",
        currency: "USD",
        profile: {
          create: {
            whatsappNumber: "+15559876543",
            instagramHandle: "@inbox_boutique_b",
            orderPrefix: "BOUTIQUE-",
            autoConfirmOrders: false,
          },
        },
      },
    });
    tenantBId = tenantB.id;
    tenantBDb = getTenantDb(tenantBId);

    // Clean up test data for idempotent test execution
    await prisma.message.deleteMany({ where: { conversation: { businessId: { in: [tenantAId, tenantBId] } } } });
    await prisma.orderItem.deleteMany({ where: { order: { businessId: { in: [tenantAId, tenantBId] } } } });
    await prisma.order.deleteMany({ where: { businessId: { in: [tenantAId, tenantBId] } } });
    await prisma.conversation.deleteMany({ where: { businessId: { in: [tenantAId, tenantBId] } } });
    await prisma.productVariant.deleteMany({ where: { product: { businessId: { in: [tenantAId, tenantBId] } } } });
    await prisma.product.deleteMany({ where: { businessId: { in: [tenantAId, tenantBId] } } });

    // 3. Create Tenant A Catalog Products
    const sweater = await prisma.product.create({
      data: {
        businessId: tenantAId,
        title: "Cashmere Knit Sweater",
        price: 150,
        stockQuantity: 15,
        trackInventory: true,
        status: ProductStatus.ACTIVE,
        variants: {
          create: [
            { title: "Medium", price: 150, stockQuantity: 10 },
            { title: "Large", price: 160, stockQuantity: 5 },
          ],
        },
      },
      include: { variants: true },
    });
    cashmereSweaterId = sweater.id;
    mediumVariantId = sweater.variants.find((v) => v.title === "Medium")!.id;
    largeVariantId = sweater.variants.find((v) => v.title === "Large")!.id;

    const scarf = await prisma.product.create({
      data: {
        businessId: tenantAId,
        title: "Mulberry Silk Scarf",
        price: 45,
        stockQuantity: 20,
        trackInventory: true,
        status: ProductStatus.ACTIVE,
      },
    });
    silkScarfId = scarf.id;
  });

  describe("1. Manual Conversation Intake & Message Threading", () => {
    let createdConvId: string;

    it("should create a manual intake conversation with initial customer message", async () => {
      const conv = await tenantADb.createConversation({
        channel: ConversationChannel.WHATSAPP,
        contactIdentifier: "+14155552671",
        contactName: "Elena Rostova",
        initialMessage: "Hi Sarah! I'd love to order 2 Cashmere Knit Sweaters in Medium please. Deliver to 452 Elm Street, San Francisco.",
        senderType: MessageSenderType.CUSTOMER,
      });

      expect(conv).toBeDefined();
      expect(conv.businessId).toBe(tenantAId);
      expect(conv.contactIdentifier).toBe("+14155552671");
      expect(conv.contactName).toBe("Elena Rostova");
      expect(conv.channel).toBe("WHATSAPP");
      expect(conv.status).toBe("OPEN");
      expect(conv.unreadCount).toBe(1);
      expect(conv.messages.length).toBe(1);
      expect(conv.messages[0].content).toContain("452 Elm Street");

      createdConvId = conv.id;
    });

    it("should append seller reply and internal notes to the message thread", async () => {
      // Seller reply
      const sellerMsg = await tenantADb.addMessage(createdConvId, {
        content: "Hi Elena! Absolutely, we have Medium in stock. I will confirm your order now.",
        senderType: MessageSenderType.SELLER,
        senderName: "Sarah Merchant",
      });
      expect(sellerMsg.senderType).toBe("SELLER");

      // Internal note
      const internalNote = await tenantADb.addMessage(createdConvId, {
        content: "[Internal Note] VIP customer from Instagram, apply standard free delivery.",
        senderType: MessageSenderType.SYSTEM,
        senderName: "System",
      });
      expect(internalNote.senderType).toBe("SYSTEM");

      // Verify thread history
      const fullConv = await tenantADb.getConversationById(createdConvId);
      expect(fullConv).not.toBeNull();
      expect(fullConv!.messages.length).toBe(3);
      expect(fullConv!.unreadCount).toBe(0); // Reset when seller responds
    });

    it("should search and filter conversations by channel and status", async () => {
      const resultAll = await tenantADb.getConversations();
      expect(resultAll.items.length).toBeGreaterThanOrEqual(1);

      const resultWhatsApp = await tenantADb.getConversations({
        channel: ConversationChannel.WHATSAPP,
      });
      expect(resultWhatsApp.items.some((c) => c.contactName === "Elena Rostova")).toBe(true);

      const resultInstagram = await tenantADb.getConversations({
        channel: ConversationChannel.INSTAGRAM,
      });
      expect(resultInstagram.items.some((c) => c.contactName === "Elena Rostova")).toBe(false);

      const searchMatch = await tenantADb.getConversations({
        search: "Elena",
      });
      expect(searchMatch.items.length).toBe(1);
      expect(searchMatch.items[0].contactName).toBe("Elena Rostova");
    });
  });

  describe("2. AI-Assisted Structured Order Details Extraction", () => {
    it("should accurately extract customer details, matched products, and variants", async () => {
      const conv = await tenantADb.createConversation({
        channel: ConversationChannel.INSTAGRAM,
        contactIdentifier: "@maya_style",
        contactName: "Maya Lin",
        initialMessage:
          "Hello! My name is Maya Lin. I want 1 Cashmere Knit Sweater size Large and 1 Mulberry Silk Scarf. Ship to: 789 Pine Ridge, Austin TX. Phone: +15125557890. Paid via GPay screenshot attached.",
        senderType: MessageSenderType.CUSTOMER,
      });

      const extracted = await tenantADb.extractOrderFromConversation(conv.id);

      expect(extracted).toBeDefined();
      expect(extracted.customerName).toBe("Maya Lin");
      expect(extracted.phone).toContain("5125557890");
      expect(extracted.shippingAddress).toContain("789 Pine Ridge");
      expect(extracted.city).toBe("Austin");

      // Check matched products
      expect(extracted.items.length).toBe(2);

      const sweaterItem = extracted.items.find((i) => i.title.includes("Sweater"));
      expect(sweaterItem).toBeDefined();
      expect(sweaterItem?.variantTitle).toBe("Large");
      expect(sweaterItem?.variantId).toBe(largeVariantId);
      expect(sweaterItem?.quantity).toBe(1);
      expect(sweaterItem?.unitPrice).toBe(160);
      expect(sweaterItem?.inStock).toBe(true);

      const scarfItem = extracted.items.find((i) => i.title.includes("Scarf"));
      expect(scarfItem).toBeDefined();
      expect(scarfItem?.quantity).toBe(1);
      expect(scarfItem?.unitPrice).toBe(45);

      // Calculations check: 160 + 45 = 205
      expect(extracted.subtotal).toBe(205);
      expect(extracted.totalAmount).toBe(205); // subtotal >= 100 free shipping

      // Payment proof detected
      expect(extracted.paymentMentioned).toBe("GPay / Google Pay");

      // Ready with no missing information
      expect(extracted.isComplete).toBe(true);
      expect(extracted.missingInformation.length).toBe(0);
    });

    it("should detect missing information when address or variant size is omitted", async () => {
      const incompleteConv = await tenantADb.createConversation({
        channel: ConversationChannel.WHATSAPP,
        contactIdentifier: "+19998887777",
        initialMessage: "I want a sweater please.",
        senderType: MessageSenderType.CUSTOMER,
      });

      const extracted = await tenantADb.extractOrderFromConversation(incompleteConv.id);

      expect(extracted.isComplete).toBe(false);
      expect(extracted.missingInformation.some((m) => m.toLowerCase().includes("variant"))).toBe(true);
      expect(extracted.missingInformation.some((m) => m.toLowerCase().includes("address"))).toBe(true);
      expect(extracted.missingInformation.some((m) => m.toLowerCase().includes("name"))).toBe(true);
    });
  });

  describe("3. Seller Review, Approval & Order Creation Workflow", () => {
    let orderConvId: string;
    let initialMediumStock: number;

    it("should require seller review and create an approved order with stock deduction", async () => {
      // Check initial stock
      const variantBefore = await prisma.productVariant.findUnique({
        where: { id: mediumVariantId },
      });
      initialMediumStock = variantBefore!.stockQuantity;

      const conv = await tenantADb.createConversation({
        channel: ConversationChannel.WHATSAPP,
        contactIdentifier: "+12125559090",
        contactName: "Chloe Martin",
        initialMessage: "Please send 2 Medium sweaters to 100 Broadway, New York, NY.",
        senderType: MessageSenderType.CUSTOMER,
      });
      orderConvId = conv.id;

      // Extract details
      const extracted = await tenantADb.extractOrderFromConversation(conv.id);

      // Seller reviews and executes approval
      const order = await tenantADb.createOrderFromConversation(orderConvId, {
        customerName: extracted.customerName || "Chloe Martin",
        customerPhone: "+12125559090",
        shippingAddress: extracted.shippingAddress || "100 Broadway, New York, NY",
        city: "New York",
        items: [
          {
            productId: cashmereSweaterId,
            variantId: mediumVariantId,
            title: "Cashmere Knit Sweater",
            variantTitle: "Medium",
            quantity: 2,
            unitPrice: 150,
          },
        ],
        discount: 20,
        discountType: "FIXED",
        shipping: 10,
        status: OrderStatus.CONFIRMED,
      });

      expect(order).toBeDefined();
      expect(order.orderNumber).toContain("ATELIER-");
      expect(order.status).toBe("CONFIRMED");
      // (150*2) - 20 + 10 = 290
      expect(Number(order.totalAmount)).toBe(290);
      expect(order.stockDeducted).toBe(true);

      // Verify stock was deducted
      const variantAfter = await prisma.productVariant.findUnique({
        where: { id: mediumVariantId },
      });
      expect(variantAfter!.stockQuantity).toBe(initialMediumStock - 2);

      // Verify conversation updated to ORDER_CREATED
      const updatedConv = await tenantADb.getConversationById(orderConvId);
      expect(updatedConv!.status).toBe("ORDER_CREATED");

      // Verify system event was recorded in thread
      const lastMsg = updatedConv!.messages[updatedConv!.messages.length - 1];
      expect(lastMsg.senderType).toBe("SYSTEM");
      expect(lastMsg.content).toContain(order.orderNumber);
    });

    it("should prevent duplicate order creation unless explicit override is provided", async () => {
      // Attempting to create an order again from the same conversation without allowDuplicate
      await expect(
        tenantADb.createOrderFromConversation(orderConvId, {
          customerName: "Chloe Martin",
          shippingAddress: "100 Broadway, New York, NY",
          items: [
            {
              productId: cashmereSweaterId,
              title: "Cashmere Knit Sweater",
              quantity: 1,
              unitPrice: 150,
            },
          ],
          allowDuplicate: false,
        })
      ).rejects.toThrow(/Duplicate order prevented/);

      // With explicit seller override
      const secondOrder = await tenantADb.createOrderFromConversation(orderConvId, {
        customerName: "Chloe Martin",
        shippingAddress: "100 Broadway, New York, NY",
        items: [
          {
            productId: cashmereSweaterId,
            title: "Cashmere Knit Sweater",
            quantity: 1,
            unitPrice: 150,
          },
        ],
        allowDuplicate: true,
      });

      expect(secondOrder).toBeDefined();
      expect(secondOrder.orderNumber).not.toBe("");
    });
  });

  describe("4. Official Webhook Challenge & Message Verification", () => {
    it("should verify WhatsApp webhook subscription challenge", () => {
      const mode = "subscribe";
      const token = "orderflow_test_token";
      const challenge = "challenge_123456";

      const verified = verifyWhatsAppWebhookSubscription(
        mode,
        token,
        challenge,
        "orderflow_test_token"
      );
      expect(verified).toBe("challenge_123456");

      const invalid = verifyWhatsAppWebhookSubscription(
        mode,
        "wrong_token",
        challenge,
        "orderflow_test_token"
      );
      expect(invalid).toBeNull();
    });

    it("should parse incoming Meta WhatsApp webhook payload", () => {
      const mockPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Alice Wonderland" }, wa_id: "14155559999" }],
                  messages: [
                    {
                      from: "14155559999",
                      id: "wamid.HBgLMTQxNTU1NTk5OTk",
                      timestamp: "1731680000",
                      text: { body: "Can I buy 1 Silk Scarf?" },
                      type: "text",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const messages = parseWhatsAppWebhook(mockPayload);
      expect(messages.length).toBe(1);
      expect(messages[0].from).toBe("14155559999");
      expect(messages[0].name).toBe("Alice Wonderland");
      expect(messages[0].text).toBe("Can I buy 1 Silk Scarf?");
    });

    it("should verify Instagram webhook subscription challenge and parse payload", () => {
      const verified = verifyInstagramWebhookSubscription(
        "subscribe",
        "ig_token_123",
        "challenge_ig",
        "ig_token_123"
      );
      expect(verified).toBe("challenge_ig");

      const mockPayload = {
        entry: [
          {
            messaging: [
              {
                sender: { id: "ig_user_4455" },
                recipient: { id: "ig_page_1122" },
                timestamp: 1731680500,
                message: {
                  mid: "mid.ig_message_9988",
                  text: "Do you have the sweater in Large?",
                },
              },
            ],
          },
        ],
      };

      const messages = parseInstagramWebhook(mockPayload);
      expect(messages.length).toBe(1);
      expect(messages[0].senderId).toBe("ig_user_4455");
      expect(messages[0].text).toBe("Do you have the sweater in Large?");
    });
  });

  describe("5. Multi-Tenant Business Data Isolation for Unified Inbox", () => {
    it("should strictly isolate conversations between Tenant A and Tenant B", async () => {
      // Tenant B creates a conversation
      const convB = await tenantBDb.createConversation({
        channel: ConversationChannel.INSTAGRAM,
        contactIdentifier: "@boutique_fan",
        contactName: "Boutique Fan",
        initialMessage: "Tenant B private DM inquiry",
      });

      // Tenant A queries conversations
      const listA = await tenantADb.getConversations();
      const foundInA = listA.items.find((c) => c.id === convB.id);
      expect(foundInA).toBeUndefined();

      // Tenant A direct lookup of Tenant B conversation should return null
      const directLookupA = await tenantADb.getConversationById(convB.id);
      expect(directLookupA).toBeNull();

      // Tenant A attempting to post message to Tenant B conversation should be blocked
      await expect(
        tenantADb.addMessage(convB.id, {
          content: "Unauthorized cross-tenant message",
          senderType: MessageSenderType.SELLER,
        })
      ).rejects.toThrow();
    });
  });
});
