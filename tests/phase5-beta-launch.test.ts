// Phase 5 Acceptance & End-to-End SaaS Beta Launch Test Suite
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import {
  OrderStatus,
  PaymentStatus,
  OrderSource,
  PaymentMethod,
  PaymentRecordStatus,
  MemberRole,
  SubscriptionPlan,
  ConversationChannel,
  DeliveryPartner,
  ShipmentStatus,
} from "@prisma/client";
import { generateCsv } from "../src/lib/csv-export";
import { rateLimiter } from "../src/lib/rate-limiter";
import { sanitizeLogData } from "../src/lib/logger";
import { PlanLimitExceededError, ForbiddenError } from "../src/lib/errors";

describe("Phase 5: SaaS Beta Launch & Business Intelligence Acceptance Tests", () => {
  let testUser: any;
  let testBusiness: any;
  let tenant: ReturnType<typeof getTenantDb>;

  beforeAll(async () => {
    // Unique seed user and business for Phase 5 tests
    const unique = `p5-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    testUser = await prisma.user.create({
      data: {
        email: `${unique}@orderflow.io`,
        name: "Phase 5 Tester",
        passwordHash: "hash123",
      },
    });

    testBusiness = await prisma.business.create({
      data: {
        name: `Beta Store ${unique}`,
        slug: unique,
        currency: "USD",
        plan: SubscriptionPlan.FREE,
        monthlyOrderLimit: 10,
        maxMembersLimit: 5,
        members: {
          create: {
            userId: testUser.id,
            role: MemberRole.OWNER,
          },
        },
      },
    });

    tenant = getTenantDb(testBusiness.id);
  });

  afterAll(async () => {
    // Clean up test workspace
    if (testBusiness) {
      await prisma.business.delete({ where: { id: testBusiness.id } });
    }
    if (testUser) {
      await prisma.user.delete({ where: { id: testUser.id } });
    }
  });

  // --------------------------------------------------------------------------
  // 1. Revenue & Order Analytics from Actual Database Records
  // --------------------------------------------------------------------------
  describe("1. Revenue & Order Analytics Engine", () => {
    it("aggregates revenue, AOV, and channel attribution from live database orders", async () => {
      // Create Customer
      const customer = await tenant.createCustomer({
        name: "Alice Beta",
        email: "alice@test.com",
        phone: "+15551234567",
      });

      // Create Product
      const product = await tenant.createProduct({
        title: "Artisan Coffee Beans",
        price: 25.0,
        costPrice: 10.0,
        stockQuantity: 100,
      });

      // Create Order 1 via WHATSAPP ($50)
      const order1 = await tenant.createOrder({
        customerId: customer.id,
        source: OrderSource.WHATSAPP,
        status: OrderStatus.DELIVERED,
        items: [{ productId: product.id, title: product.title, quantity: 2, unitPrice: 25.0 }],
      });

      // Create Order 2 via INSTAGRAM ($75)
      const order2 = await tenant.createOrder({
        customerId: customer.id,
        source: OrderSource.INSTAGRAM,
        status: OrderStatus.CONFIRMED,
        items: [{ productId: product.id, title: product.title, quantity: 3, unitPrice: 25.0 }],
      });

      // Create Order 3 CANCELLED ($25)
      await tenant.createOrder({
        customerId: customer.id,
        source: OrderSource.MANUAL,
        status: OrderStatus.CANCELLED,
        items: [{ productId: product.id, title: product.title, quantity: 1, unitPrice: 25.0 }],
      });

      const analytics = await tenant.getRevenueAnalytics({ days: 30 });

      // Active orders = order1 ($50) + order2 ($75) = $125
      expect(analytics.grossRevenue).toBe(125.0);
      expect(analytics.totalOrders).toBe(3); // total including cancelled
      expect(analytics.completedOrders).toBe(1); // order1 delivered
      expect(analytics.pendingOrders).toBe(1); // order2 confirmed
      expect(analytics.cancelledOrders).toBe(1);
      expect(analytics.averageOrderValue).toBe(62.5); // 125 / 2 active orders

      // Channel breakdown verification
      const waChannel = analytics.channelBreakdown.find((c) => c.channel === OrderSource.WHATSAPP);
      const igChannel = analytics.channelBreakdown.find((c) => c.channel === OrderSource.INSTAGRAM);
      expect(waChannel?.revenue).toBe(50.0);
      expect(waChannel?.orders).toBe(1);
      expect(igChannel?.revenue).toBe(75.0);
      expect(igChannel?.orders).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Product Performance & Inventory Valuation
  // --------------------------------------------------------------------------
  describe("2. Product Performance & Valuation", () => {
    it("calculates top products by units sold and inventory retail vs cost valuation", async () => {
      const performance = await tenant.getProductPerformance();

      expect(performance.topProducts.length).toBeGreaterThan(0);
      const top = performance.topProducts[0];
      expect(top.title).toBe("Artisan Coffee Beans");
      expect(top.unitsSold).toBe(5); // 2 in order1 + 3 in order2
      expect(top.revenue).toBe(125.0);

      // Inventory summary
      expect(performance.inventorySummary.totalProducts).toBeGreaterThanOrEqual(1);
      expect(performance.inventorySummary.totalStockUnits).toBeGreaterThan(0);
      expect(performance.inventorySummary.totalRetailValue).toBeGreaterThan(0);
      expect(performance.inventorySummary.totalCostValue).toBeGreaterThan(0);
      expect(performance.inventorySummary.totalRetailValue).toBeGreaterThan(
        performance.inventorySummary.totalCostValue
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Customer Retention & Repeat Buyer Metrics
  // --------------------------------------------------------------------------
  describe("3. Customer Retention Metrics", () => {
    it("detects repeat customers and calculates Lifetime Value accurately", async () => {
      const retention = await tenant.getCustomerRetention();

      expect(retention.totalCustomers).toBeGreaterThanOrEqual(1);
      expect(retention.repeatCustomers).toBeGreaterThanOrEqual(1);
      expect(retention.repeatCustomerRate).toBeGreaterThan(0);
      expect(retention.averageLifetimeValue).toBeGreaterThan(0);

      const topCust = retention.topCustomers.find((c) => c.name === "Alice Beta");
      expect(topCust).toBeDefined();
      expect(topCust?.ordersCount).toBeGreaterThanOrEqual(2);
      expect(topCust?.totalSpent).toBe(125.0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Payment Reconciliation & Outstanding Receivables
  // --------------------------------------------------------------------------
  describe("4. Payment Reports & Outstanding Receivables", () => {
    it("tracks verified payments and identifies orders with outstanding balances", async () => {
      const orders = await tenant.getOrders();
      const confirmedOrder = orders.items.find((o) => o.status === OrderStatus.CONFIRMED);
      expect(confirmedOrder).toBeDefined();

      // Record a partial payment of $25 on $75 order
      const payment = await tenant.recordPayment(confirmedOrder!.id, {
        amount: 25.0,
        method: PaymentMethod.UPI,
        referenceNumber: "UPI-BETA-123",
      });

      // Verify the payment
      await tenant.verifyPayment(payment.id, { action: "VERIFY" });

      const report = await tenant.getPaymentReport();

      expect(report.totalCollected).toBeGreaterThanOrEqual(25.0);
      expect(report.totalOutstanding).toBeGreaterThanOrEqual(50.0); // $75 - $25 = $50 due

      const outstandingItem = report.outstandingOrders.find((o) => o.id === confirmedOrder!.id);
      expect(outstandingItem).toBeDefined();
      expect(outstandingItem?.totalAmount).toBe(75.0);
      expect(outstandingItem?.amountPaid).toBe(25.0);
      expect(outstandingItem?.balanceDue).toBe(50.0);
    });
  });

  // --------------------------------------------------------------------------
  // 5. RFC-4180 CSV Export Generation
  // --------------------------------------------------------------------------
  describe("5. CSV Data Export Engine", () => {
    it("formats CSV with proper headers, quotes, and UTF-8 BOM", () => {
      const headers = ["Order ID", "Customer Name", "Notes"];
      const rows = [
        ["ORD-1001", "Alice, Wonderland", 'Contains "special" character & newline\ntest'],
        ["ORD-1002", "Bob Smith", "Standard note"],
      ];

      const csv = generateCsv(headers, rows);

      // Verify UTF-8 BOM
      expect(csv.startsWith("\uFEFF")).toBe(true);
      // Verify commas inside values are quoted
      expect(csv).toContain('"Alice, Wonderland"');
      // Verify escaped double quotes
      expect(csv).toContain('""special""');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Subscription Architecture & Monthly Quota Enforcement
  // --------------------------------------------------------------------------
  describe("6. Subscription Quota Enforcement", () => {
    it("enforces monthly order limits and unlocks throughput upon tier upgrade", async () => {
      // Temporarily lower limit to current order count to trigger limit
      const usage = await tenant.getSubscriptionUsage();
      await prisma.business.update({
        where: { id: testBusiness.id },
        data: { monthlyOrderLimit: usage.ordersUsed },
      });

      // Attempting to create an order must throw PlanLimitExceededError
      await expect(
        tenant.createOrder({
          status: OrderStatus.CONFIRMED,
          items: [{ title: "Excess Item", quantity: 1, unitPrice: 10 }],
        })
      ).rejects.toThrow(PlanLimitExceededError);

      // Upgrade plan to PRO
      const upgraded = await tenant.updateSubscriptionPlan(SubscriptionPlan.PRO);
      expect(upgraded.plan).toBe(SubscriptionPlan.PRO);
      expect(upgraded.ordersLimit).toBe(500);

      // Creating order now succeeds
      const newOrder = await tenant.createOrder({
        status: OrderStatus.CONFIRMED,
        items: [{ title: "Unlocked Item", quantity: 1, unitPrice: 15 }],
      });
      expect(newOrder.orderNumber).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // 7. Team Member Invitations & Role-Based Access Control (RBAC)
  // --------------------------------------------------------------------------
  describe("7. Team Invitations & RBAC Permissions", () => {
    let inviteToken: string;
    let inviteeUser: any;

    it("allows Owner/Admin to invite team members with expiration and token", async () => {
      const inviteeEmail = `invitee-${Date.now()}@orderflow.io`;
      const invite = await tenant.inviteTeamMember(testUser.id, inviteeEmail, MemberRole.STAFF);

      expect(invite.email).toBe(inviteeEmail);
      expect(invite.role).toBe(MemberRole.STAFF);
      expect(invite.token).toBeDefined();
      expect(invite.status).toBe("PENDING");
      inviteToken = invite.token;

      // Pending invitations list
      const pendingList = await tenant.getInvitations();
      expect(pendingList.some((i) => i.token === inviteToken)).toBe(true);
    });

    it("allows invited user to accept token and join workspace", async () => {
      inviteeUser = await prisma.user.create({
        data: {
          email: `accepted-${Date.now()}@orderflow.io`,
          name: "John Staff",
        },
      });

      const { acceptInvitation } = await import("../src/lib/team");
      const result = await acceptInvitation(inviteToken, inviteeUser.id);

      expect(result.success).toBe(true);
      expect(result.businessId).toBe(testBusiness.id);
      expect(result.role).toBe(MemberRole.STAFF);

      // Membership verification in database
      const memberRecord = await prisma.businessMember.findUnique({
        where: { businessId_userId: { businessId: testBusiness.id, userId: inviteeUser.id } },
      });
      expect(memberRecord).toBeDefined();
      expect(memberRecord?.role).toBe(MemberRole.STAFF);
    });

    it("prevents non-admins from inviting members and protects owner from removal", async () => {
      // Invitee with STAFF role cannot invite members
      await expect(
        tenant.inviteTeamMember(inviteeUser.id, "someone@test.com", MemberRole.STAFF)
      ).rejects.toThrow(ForbiddenError);

      // Finding owner member record
      const ownerMember = await prisma.businessMember.findFirst({
        where: { businessId: testBusiness.id, role: MemberRole.OWNER },
      });
      expect(ownerMember).toBeDefined();

      // Trying to remove owner must fail
      await expect(
        tenant.removeMember(ownerMember!.id, testUser.id)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // --------------------------------------------------------------------------
  // 8. API Rate Limiting & Sensitive Data Scrubbing
  // --------------------------------------------------------------------------
  describe("8. Rate Limiting & Structured Logging", () => {
    it("rate limiter throttles requests after reaching threshold", () => {
      const testKey = `rl-test-${Date.now()}`;
      const limit = 3;
      const windowMs = 5000;

      // First 3 requests allowed
      expect(rateLimiter.check(testKey, limit, windowMs).allowed).toBe(true);
      expect(rateLimiter.check(testKey, limit, windowMs).allowed).toBe(true);
      expect(rateLimiter.check(testKey, limit, windowMs).allowed).toBe(true);

      // 4th request blocked
      const blocked = rateLimiter.check(testKey, limit, windowMs);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it("scrubs sensitive tokens, passwords, and secrets from structured logs", () => {
      const payload = {
        email: "merchant@test.com",
        password: "SuperSecretPassword123!",
        whatsappAccessToken: "EAABwz...",
        nested: {
          jwtSecret: "secretKey",
          validField: "KeepMe",
        },
      };

      const sanitized = sanitizeLogData(payload);

      expect(sanitized.email).toBe("merchant@test.com");
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.whatsappAccessToken).toBe("[REDACTED]");
      expect(sanitized.nested.jwtSecret).toBe("[REDACTED]");
      expect(sanitized.nested.validField).toBe("KeepMe");
    });
  });

  // --------------------------------------------------------------------------
  // 9. Full End-to-End Multi-Phase SaaS Beta Journey
  // --------------------------------------------------------------------------
  describe("9. End-to-End Complete Business Lifecycle", () => {
    it("runs complete journey: conversation -> order -> partial payment -> shipment -> analytics", async () => {
      // 1. Inbound WhatsApp Conversation
      const conv = await tenant.createConversation({
        channel: ConversationChannel.WHATSAPP,
        contactIdentifier: "+15559876543",
        contactName: "Beta VIP Customer",
        initialMessage: "Hi, I would like to order 2 packs of Artisan Coffee Beans please",
      });
      expect(conv.id).toBeDefined();

      // 2. Structured Order Approval & Creation
      const product = (await tenant.getProducts()).items[0];
      const order = await tenant.createOrderFromConversation(conv.id, {
        customerName: "Beta VIP Customer",
        customerPhone: "+15559876543",
        items: [{ productId: product.id, title: product.title, quantity: 2, unitPrice: product.price }],
        shipping: 10.0,
      });
      expect(Number(order.totalAmount)).toBe(60.0); // 2 * 25 + 10 = 60

      // 3. Record UPI Payment ($30)
      const pay = await tenant.recordPayment(order.id, {
        amount: 30.0,
        method: PaymentMethod.UPI,
        referenceNumber: "UPI-E2E-999",
      });
      await tenant.verifyPayment(pay.id, { action: "VERIFY" });

      // 4. Create Shipment with Delivery Partner
      const shipment = await tenant.createShipment(order.id, {
        carrier: DeliveryPartner.BLUEDART,
        trackingNumber: "BD-987654321",
        shippingAddress: "742 Evergreen Terrace, Springfield",
      });
      expect(shipment.carrier).toBe(DeliveryPartner.BLUEDART);

      // 5. Update Shipment to DELIVERED
      const updatedShipment = await tenant.updateShipmentStatus(shipment.id, {
        status: ShipmentStatus.DELIVERED,
      });
      expect(updatedShipment.status).toBe(ShipmentStatus.DELIVERED);

      // 6. Audit Trail was generated
      const auditLogs = await tenant.getAuditLogs({ limit: 5 });
      expect(auditLogs.items.length).toBeGreaterThan(0);

      // 7. Analytics dynamically reflects all state changes
      const report = await tenant.getPaymentReport();
      const e2eOrder = report.outstandingOrders.find((o) => o.id === order.id);
      expect(e2eOrder).toBeDefined();
      expect(e2eOrder?.balanceDue).toBe(30.0); // $60 - $30 = $30
    });
  });
});
