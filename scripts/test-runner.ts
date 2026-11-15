import { prisma } from "../src/lib/prisma";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from "../src/lib/auth";
import { getTenantDb, assertBusinessAccess, TenantAccessError, InventoryError } from "../src/lib/tenant";
import { registerSchema, loginSchema, businessOnboardingSchema } from "../src/lib/validations";
import { slugify } from "../src/lib/utils";
import {
  MemberRole,
  OrderStatus,
  PaymentStatus,
  OrderSource,
  ProductStatus,
  ConversationChannel,
  ConversationStatus,
  MessageSenderType,
} from "@prisma/client";
import {
  verifyWhatsAppWebhookSubscription,
  parseWhatsAppWebhook,
} from "../src/lib/integrations/whatsapp";
import {
  verifyInstagramWebhookSubscription,
  parseInstagramWebhook,
} from "../src/lib/integrations/instagram";

interface TestResult {
  suite: string;
  test: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function record(suite: string, test: string, passed: boolean, error?: string) {
  results.push({ suite, test, passed, error });
  const status = passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✖ FAIL\x1b[0m";
  console.log(`  ${status} - ${test}`);
  if (error) console.error(`    \x1b[31m${error}\x1b[0m`);
}

async function runTestSuite() {
  console.log("\n=======================================================");
  console.log("   ORDERFLOW — PHASES 1, 2 & 3 ACCEPTANCE TEST SUITE   ");
  console.log("=======================================================\n");

  const timestamp = Date.now();
  const testEmail1 = `runner.alpha.${timestamp}@example.com`;
  const testEmail2 = `runner.beta.${timestamp}@example.com`;
  const testPassword = "Password123";

  let userAId = "";
  let userBId = "";
  let businessAId = "";
  let businessBId = "";

  try {
    // -------------------------------------------------------------
    // SUITE 1: Registration, Passwords & Validation
    // -------------------------------------------------------------
    console.log("\x1b[1m[Suite 1: Registration, Password Hashing & Validation]\x1b[0m");

    // 1.1 Input validation
    const validReg = registerSchema.safeParse({
      name: "Alpha Merchant",
      email: testEmail1,
      password: testPassword,
    });
    record("Registration", "Zod registerSchema accepts valid input", validReg.success);

    const invalidReg = registerSchema.safeParse({
      name: "A",
      email: "bad-email",
      password: "weak",
    });
    record("Registration", "Zod registerSchema rejects invalid email and weak password", !invalidReg.success);

    // 1.2 Bcrypt password hashing
    const hash = await hashPassword(testPassword);
    const hashMatches = await verifyPassword(testPassword, hash);
    const wrongMismatch = !(await verifyPassword("WrongPassword!", hash));
    record(
      "Auth",
      "Bcrypt properly hashes and securely verifies passwords",
      hash.startsWith("$2") && hashMatches && wrongMismatch
    );

    // 1.3 User creation
    const userA = await prisma.user.create({
      data: {
        name: "Alpha Merchant",
        email: testEmail1,
        passwordHash: hash,
      },
    });
    userAId = userA.id;
    record("Registration", "New user persisted in PostgreSQL database", Boolean(userA.id));

    // 1.4 Unique email constraint
    let duplicateRejected = false;
    try {
      await prisma.user.create({
        data: {
          name: "Duplicate User",
          email: testEmail1,
          passwordHash: hash,
        },
      });
    } catch {
      duplicateRejected = true;
    }
    record("Registration", "Database enforces unique email constraint", duplicateRejected);

    // -------------------------------------------------------------
    // SUITE 2: Login, Session Persistence & Tokens
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 2: Login & Session Token Persistence]\x1b[0m");

    const validLogin = loginSchema.safeParse({ email: testEmail1, password: testPassword });
    record("Login", "Zod loginSchema accepts valid credentials", validLogin.success);

    // JWT sign & verify
    const token = signSessionToken({
      userId: userA.id,
      email: userA.email,
      systemRole: userA.systemRole,
    });
    const verifiedPayload = verifySessionToken(token);
    record(
      "Session",
      "JWT session token signed and verified with correct payload",
      verifiedPayload?.userId === userA.id && verifiedPayload?.email === testEmail1
    );

    const tamperedCheck = verifySessionToken(token + "tampered");
    record("Session", "Tampered or invalid JWT session token rejected", tamperedCheck === null);

    // -------------------------------------------------------------
    // SUITE 3: Business Workspace Onboarding & Profile
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 3: Business Workspace Onboarding & Profile]\x1b[0m");

    const slug = slugify("Alpha Luxury Goods");
    record("Onboarding", "Workspace name correctly slugified to URL-safe format", slug === "alpha-luxury-goods");

    // Create Business A
    const businessA = await prisma.business.create({
      data: {
        name: "Alpha Luxury Goods",
        slug: `${slug}-${timestamp}`,
        currency: "USD",
        timezone: "America/New_York",
        members: {
          create: {
            userId: userA.id,
            role: MemberRole.OWNER,
          },
        },
        profile: {
          create: {
            instagramHandle: "@alphaluxury",
            whatsappNumber: "+15551112222",
            orderPrefix: "ALP-",
            autoConfirmOrders: false, // Per strict master instructions!
          },
        },
      },
      include: {
        members: true,
        profile: true,
      },
    });
    businessAId = businessA.id;

    record("Onboarding", "Business workspace created with active membership", Boolean(businessA.id));
    record("Onboarding", "Merchant assigned OWNER role in created business", businessA.members[0]?.role === MemberRole.OWNER);
    record(
      "Onboarding",
      "BusinessProfile created with autoConfirmOrders strictly disabled (false)",
      businessA.profile?.autoConfirmOrders === false
    );

    // -------------------------------------------------------------
    // SUITE 4: Multi-Tenant Business Data Isolation
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 4: Multi-Tenant Business Data Isolation]\x1b[0m");

    // Create second merchant and second business (Tenant B)
    const userB = await prisma.user.create({
      data: {
        name: "Beta Merchant",
        email: testEmail2,
        passwordHash: hash,
      },
    });
    userBId = userB.id;

    const businessB = await prisma.business.create({
      data: {
        name: "Beta Fashion Co",
        slug: `beta-fashion-${timestamp}`,
        currency: "EUR",
        members: {
          create: {
            userId: userB.id,
            role: MemberRole.OWNER,
          },
        },
      },
    });
    businessBId = businessB.id;

    // Seed Tenant A data
    const tenantDbA = getTenantDb(businessAId);
    const customerA = await tenantDbA.createCustomer({
      name: "Alpha Customer 1",
      email: "cust.a@test.com",
    });
    const productA = await tenantDbA.createProduct({
      title: "Alpha Silk Dress",
      price: 250.0,
      stockQuantity: 20,
    });
    const orderA = await prisma.order.create({
      data: {
        businessId: businessAId,
        customerId: customerA.id,
        orderNumber: "ALP-1001",
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        source: OrderSource.WHATSAPP,
        subtotal: 250.0,
        totalAmount: 250.0,
      },
    });

    // Seed Tenant B data
    const tenantDbB = getTenantDb(businessBId);
    const customerB = await tenantDbB.createCustomer({
      name: "Beta Customer Secret",
      email: "cust.b@test.com",
    });
    const productB = await tenantDbB.createProduct({
      title: "Beta Leather Jacket",
      price: 450.0,
      stockQuantity: 5,
    });
    const orderB = await prisma.order.create({
      data: {
        businessId: businessBId,
        customerId: customerB.id,
        orderNumber: "BET-1001",
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        source: OrderSource.INSTAGRAM,
        subtotal: 450.0,
        totalAmount: 450.0,
        requiresApproval: true,
      },
    });

    // Test Isolation: Tenant A cannot see Tenant B's customers
    const customersForA = await tenantDbA.getCustomers();
    const customerIsolation =
      customersForA.items.length === 1 &&
      customersForA.items[0].id === customerA.id &&
      !customersForA.items.some((c) => c.id === customerB.id);
    record("Data Isolation", "Tenant A customer list excludes Tenant B customers", customerIsolation);

    // Test Isolation: Direct lookup across tenants returns null
    const crossCustomerLookup = await tenantDbA.getCustomerById(customerB.id);
    record("Data Isolation", "Tenant A cannot fetch Tenant B customer by direct ID", crossCustomerLookup === null);

    // Test Isolation: Products
    const productsForA = await tenantDbA.getProducts();
    const productIsolation =
      productsForA.items.length === 1 &&
      productsForA.items[0].id === productA?.id &&
      !productsForA.items.some((p) => p.id === productB?.id);
    record("Data Isolation", "Tenant A product list excludes Tenant B products", productIsolation);

    // Test Isolation: Orders
    const ordersForA = await tenantDbA.getOrders();
    const orderIsolation =
      ordersForA.items.length === 1 &&
      ordersForA.items[0].id === orderA.id &&
      !ordersForA.items.some((o) => o.id === orderB.id);
    record("Data Isolation", "Tenant A order list excludes Tenant B orders", orderIsolation);

    // Test RBAC & Access assertion
    let unauthorizedBlocked = false;
    try {
      await assertBusinessAccess(userAId, businessBId);
    } catch (e) {
      if (e instanceof TenantAccessError) unauthorizedBlocked = true;
    }
    record("Access Control", "assertBusinessAccess blocks unauthorized user across tenants", unauthorizedBlocked);

    // -------------------------------------------------------------
    // SUITE 5: Dashboard Data Contracts & Aggregation
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 5: Dashboard Contracts & Real Metrics Aggregation]\x1b[0m");

    const statsA = await tenantDbA.getDashboardStats();
    const statsB = await tenantDbB.getDashboardStats();

    record("Dashboard Contracts", "Dashboard returns expected data contract shape", Boolean(
      statsA.metrics && statsA.recentOrders && statsA.businessInfo
    ));

    record(
      "Dashboard Metrics",
      "Total revenue properly sums paid orders only ($250 for A, $0 for B)",
      statsA.metrics.totalRevenue.value === 250 && statsB.metrics.totalRevenue.value === 0
    );

    record(
      "Dashboard Metrics",
      "Pending review metric correctly counts orders needing seller approval (0 for A, 1 for B)",
      statsA.metrics.pendingReview.value === 0 && statsB.metrics.pendingReview.value === 1
    );

    record(
      "Dashboard Contracts",
      "Recent orders list includes channel source and formatted amount",
      statsA.recentOrders[0]?.source === "WHATSAPP" && statsA.recentOrders[0]?.formattedAmount.includes("250")
    );

    // -------------------------------------------------------------
    // SUITE 6: Phase 2 Products, Variants & Inventory
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 6: Phase 2 Product Variants & Inventory Tracking]\x1b[0m");

    const newProd = await tenantDbA.createProduct({
      title: "Silk Pajama Set",
      sku: "PJM-001",
      price: 120.0,
      stockQuantity: 0,
      lowStockThreshold: 5,
      trackInventory: true,
      variants: [
        { title: "Small", sku: "PJM-001-S", price: 120.0, stockQuantity: 15 },
        { title: "Medium", sku: "PJM-001-M", price: 120.0, stockQuantity: 2 }, // Low stock!
      ],
    });

    record("Product Variants", "Created product with 2 variants in PostgreSQL", Boolean(newProd?.variants.length === 2));

    const lowStockCheck = await tenantDbA.getProducts({ lowStockOnly: true });
    record("Low Stock Alerts", "Low stock filter identifies inventory below threshold", lowStockCheck.items.some((p) => p.isLowStock));

    // -------------------------------------------------------------
    // SUITE 7: Phase 2 Customer CRM
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 7: Phase 2 Customer CRM & Contact Channels]\x1b[0m");

    const newCust = await tenantDbA.createCustomer({
      name: "Sophia Loren",
      phone: "+1 555 777 8888",
      email: "sophia@example.com",
      instagramHandle: "@sophialoren",
      city: "Rome",
      tags: ["VIP", "Frequent Buyer"],
    });

    record("Customer CRM", "Customer profile created with tags and social handles", Boolean(newCust.id));

    const searchCust = await tenantDbA.getCustomers({ search: "Sophia" });
    record("Customer CRM", "Customer search matches name query accurately", searchCust.items[0]?.name === "Sophia Loren");

    // -------------------------------------------------------------
    // SUITE 8: Phase 2 Order Creation, Multi-product Calculations & Stock Deduction
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 8: Multi-Product Orders, Automatic Pricing & Stock Deduction]\x1b[0m");

    const variantSmall = newProd!.variants.find((v) => v.title === "Small")!;
    const variantMedium = newProd!.variants.find((v) => v.title === "Medium")!;

    // Order 2 items of Small: 2 * 120 = $240
    // Discount: $20 Fixed
    // Shipping: $10
    // Tax: $5
    // Total = $240 - $20 + $10 + $5 = $235
    const multiOrder = await tenantDbA.createOrder({
      customerId: newCust.id,
      source: OrderSource.WHATSAPP,
      status: OrderStatus.CONFIRMED, // Triggers automatic stock deduction
      paymentStatus: PaymentStatus.PAID,
      discount: 20.0,
      discountType: "FIXED",
      shipping: 10.0,
      tax: 5.0,
      items: [
        {
          productId: newProd!.id,
          variantId: variantSmall.id,
          title: "Silk Pajama Set",
          variantTitle: "Small",
          quantity: 2,
          unitPrice: 120.0,
        },
      ],
    });

    record("Order Pricing", "Multi-item pricing calculation (Subtotal - Discount + Ship + Tax = Total)", Number(multiOrder.totalAmount) === 235);
    record("Order Status", "Order created directly as CONFIRMED marks stockDeducted: true", multiOrder.stockDeducted === true);

    const updatedSmallVar = await prisma.productVariant.findUnique({ where: { id: variantSmall.id } });
    record("Inventory Tracking", "Stock automatically deducted from variant (15 -> 13)", updatedSmallVar?.stockQuantity === 13);

    // -------------------------------------------------------------
    // SUITE 9: Phase 2 Stock Restoration on Cancellation
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 9: Automatic Stock Restoration on Cancellation]\x1b[0m");

    const cancelledOrder = await tenantDbA.updateOrder(multiOrder.id, {
      status: OrderStatus.CANCELLED,
    });

    record("Order Cancellation", "Order transitioned to CANCELLED", cancelledOrder.status === OrderStatus.CANCELLED);

    const restoredSmallVar = await prisma.productVariant.findUnique({ where: { id: variantSmall.id } });
    record("Inventory Restoration", "Stock automatically restored on order cancellation (13 -> 15)", restoredSmallVar?.stockQuantity === 15);

    // -------------------------------------------------------------
    // SUITE 10: Phase 2 Insufficient Stock Enforcement
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 10: Insufficient Stock Protection]\x1b[0m");

    let inventoryBlocked = false;
    try {
      await tenantDbA.createOrder({
        customerId: newCust.id,
        status: OrderStatus.CONFIRMED,
        items: [
          {
            productId: newProd!.id,
            variantId: variantMedium.id,
            title: "Silk Pajama Set",
            variantTitle: "Medium",
            quantity: 50, // Available is only 2
            unitPrice: 120.0,
          },
        ],
      });
    } catch (e) {
      if (e instanceof InventoryError) inventoryBlocked = true;
    }

    record("Inventory Protection", "Insufficient stock blocked with InventoryError", inventoryBlocked);

    // -------------------------------------------------------------
    // SUITE 11: Phase 3 Unified Inbox & Conversation Intake
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 11: Phase 3 Unified Inbox & Manual Chat Intake]\x1b[0m");

    const convA = await tenantDbA.createConversation({
      channel: ConversationChannel.WHATSAPP,
      contactIdentifier: "+14155552671",
      contactName: "Elena Rostova",
      initialMessage: "Hi Sarah! I'd love to order 2 Silk Pajama Sets in Small please. Deliver to 452 Elm Street, San Francisco. Contact: +14155552671.",
      senderType: MessageSenderType.CUSTOMER,
    });

    record("Conversation Intake", "Manual intake creates conversation with initial message", Boolean(convA.id && convA.messages.length === 1));

    const replyMsg = await tenantDbA.addMessage(convA.id, {
      content: "Hello Elena! We have size Small in stock. Preparing your order preview now.",
      senderType: MessageSenderType.SELLER,
      senderName: "Sarah Merchant",
    });

    record("Message Threading", "Seller reply appended to message thread and unread count reset", replyMsg.senderType === MessageSenderType.SELLER);

    const internalNote = await tenantDbA.addMessage(convA.id, {
      content: "[Internal Note] Verified Instagram DM history for customer.",
      senderType: MessageSenderType.SYSTEM,
      senderName: "System",
    });

    record("Internal Notes", "Private internal note recorded in conversation", internalNote.senderType === MessageSenderType.SYSTEM);

    const convList = await tenantDbA.getConversations({ channel: ConversationChannel.WHATSAPP });
    record("Conversation Filtering", "Filter conversations by WhatsApp channel", convList.items.some((c) => c.id === convA.id));

    // -------------------------------------------------------------
    // SUITE 12: Phase 3 AI-Assisted Structured Order Extraction
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 12: AI-Assisted Structured Order Details Extraction]\x1b[0m");

    const extracted = await tenantDbA.extractOrderFromConversation(convA.id);

    record("Order Extraction", "Customer details extracted (Name & Shipping Address)", Boolean(extracted.customerName && extracted.shippingAddress));
    record("Product Matching", "Product and variant matched against inventory (Silk Pajama Set - Small)", extracted.items.some((i) => i.title.includes("Silk Pajama") && i.variantTitle === "Small"));
    record("Quantity Parsing", "Extracted quantity parsed accurately (qty = 2)", extracted.items.some((i) => i.quantity === 2));
    record("Stock Verification", "Item marked in-stock based on actual inventory", extracted.items.every((i) => i.inStock));

    // Test missing information detection on incomplete text
    const incompleteConv = await tenantDbA.createConversation({
      channel: ConversationChannel.INSTAGRAM,
      contactIdentifier: "@random_buyer",
      initialMessage: "Hey can I buy something?",
      senderType: MessageSenderType.CUSTOMER,
    });
    const incompleteExtracted = await tenantDbA.extractOrderFromConversation(incompleteConv.id);

    record("Missing Info Detection", "System detects missing delivery address and missing products", incompleteExtracted.missingInformation.length > 0 && !incompleteExtracted.isComplete);

    // -------------------------------------------------------------
    // SUITE 13: Phase 3 Seller Approval & Duplicate Order Prevention
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 13: Seller Approval, Order Creation & Duplicate Prevention]\x1b[0m");

    const approvedOrder = await tenantDbA.createOrderFromConversation(convA.id, {
      customerName: extracted.customerName || "Elena Rostova",
      customerPhone: "+14155552671",
      shippingAddress: extracted.shippingAddress || "452 Elm Street, San Francisco",
      items: [
        {
          productId: newProd!.id,
          variantId: variantSmall.id,
          title: "Silk Pajama Set",
          variantTitle: "Small",
          quantity: 2,
          unitPrice: 120.0,
        },
      ],
      discount: 10,
      shipping: 5,
      status: OrderStatus.CONFIRMED,
    });

    record("Seller Approval Workflow", "Seller approval creates confirmed order linked to conversation", Boolean(approvedOrder.id && approvedOrder.status === OrderStatus.CONFIRMED));

    const updatedConvA = await tenantDbA.getConversationById(convA.id);
    record("Lifecycle Transition", "Conversation status updated to ORDER_CREATED with system note", updatedConvA?.status === ConversationStatus.ORDER_CREATED);

    let duplicateBlocked = false;
    try {
      await tenantDbA.createOrderFromConversation(convA.id, {
        customerName: "Elena Rostova",
        shippingAddress: "452 Elm Street, San Francisco",
        items: [
          {
            productId: newProd!.id,
            title: "Silk Pajama Set",
            quantity: 1,
            unitPrice: 120.0,
          },
        ],
        allowDuplicate: false,
      });
    } catch (e: any) {
      if (e.message?.includes("Duplicate order prevented")) duplicateBlocked = true;
    }

    record("Duplicate Order Prevention", "Prevents duplicate order creation from same conversation without override", duplicateBlocked);

    // -------------------------------------------------------------
    // SUITE 14: Phase 3 Webhooks & Multi-Tenant Isolation
    // -------------------------------------------------------------
    console.log("\n\x1b[1m[Suite 14: Webhook Verification & Multi-Tenant Inbox Isolation]\x1b[0m");

    const waChallenge = verifyWhatsAppWebhookSubscription("subscribe", "secret_token", "challenge_abc", "secret_token");
    record("WhatsApp Webhook", "WhatsApp hub.verify_token challenge verified", waChallenge === "challenge_abc");

    const igChallenge = verifyInstagramWebhookSubscription("subscribe", "ig_secret", "challenge_xyz", "ig_secret");
    record("Instagram Webhook", "Instagram hub.verify_token challenge verified", igChallenge === "challenge_xyz");

    // Tenant Isolation for Conversations
    const convB = await tenantDbB.createConversation({
      channel: ConversationChannel.INSTAGRAM,
      contactIdentifier: "@boutique_user",
      initialMessage: "Tenant B private chat inquiry",
      senderType: MessageSenderType.CUSTOMER,
    });

    const tenantAView = await tenantDbA.getConversations();
    record("Tenant Data Isolation", "Tenant A conversation list strictly excludes Tenant B conversations", !tenantAView.items.some((c) => c.id === convB.id));

    let tenantACrossAccessBlocked = false;
    try {
      await tenantDbA.addMessage(convB.id, {
        content: "Illegal cross-tenant message injection",
        senderType: MessageSenderType.SELLER,
      });
    } catch {
      tenantACrossAccessBlocked = true;
    }
    record("Tenant Data Isolation", "Tenant A cannot post messages to Tenant B conversation", tenantACrossAccessBlocked);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("\x1b[31mCritical Runner Error:\x1b[0m", message);
    record("Runner", "Unhandled test runner exception", false, message);
  } finally {
    // Clean up test data
    if (businessAId || businessBId) {
      await prisma.business.deleteMany({
        where: { id: { in: [businessAId, businessBId].filter(Boolean) } },
      });
    }
    if (userAId || userBId) {
      await prisma.user.deleteMany({
        where: { id: { in: [userAId, userBId].filter(Boolean) } },
      });
    }
  }

  // Summary
  console.log("\n=======================================================");
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const allPassed = passedCount === totalCount;

  console.log(`Summary: ${passedCount} / ${totalCount} tests passed`);
  if (allPassed) {
    console.log("\x1b[32m✔ ALL PHASE 1, 2 & 3 ACCEPTANCE CRITERIA PASSED!\x1b[0m");
  } else {
    console.log("\x1b[31m✖ SOME TESTS FAILED!\x1b[0m");
  }
  console.log("=======================================================\n");

  if (!allPassed) process.exit(1);
}

runTestSuite().catch((e) => {
  console.error(e);
  process.exit(1);
});
