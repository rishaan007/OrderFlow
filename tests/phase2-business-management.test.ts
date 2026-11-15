import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb, InventoryError } from "../src/lib/tenant";
import { MemberRole, OrderStatus, PaymentStatus, OrderSource, ProductStatus } from "@prisma/client";

describe("Phase 2: Core Business Management System Acceptance Tests", () => {
  let user: { id: string; email: string };
  let business: { id: string; name: string };
  let tenantDb: ReturnType<typeof getTenantDb>;

  let productId1: string;
  let variantId1: string;
  let variantId2: string;
  let customerId1: string;
  let createdOrderId: string;

  beforeAll(async () => {
    // 1. Create merchant user & business
    user = await prisma.user.create({
      data: {
        name: "Phase 2 Merchant",
        email: `phase2.merchant.${Date.now()}@example.com`,
      },
    });

    business = await prisma.business.create({
      data: {
        name: "Phase 2 Boutique",
        slug: `phase2-boutique-${Date.now()}`,
        currency: "USD",
        members: {
          create: {
            userId: user.id,
            role: MemberRole.OWNER,
          },
        },
        profile: {
          create: {
            orderPrefix: "TEST-",
            autoConfirmOrders: false,
          },
        },
      },
    });

    tenantDb = getTenantDb(business.id);
  });

  // -------------------------------------------------------------
  // TEST SUITE 1: Product Management & Variants
  // -------------------------------------------------------------
  describe("Product & Variant Management", () => {
    it("should create a product with multiple variants and initial stock", async () => {
      const product = await tenantDb.createProduct({
        title: "Cashmere Sweater",
        sku: "CS-001",
        category: "Knitwear",
        description: "100% pure Mongolian cashmere sweater.",
        price: 150.0,
        costPrice: 60.0,
        stockQuantity: 0,
        lowStockThreshold: 4,
        trackInventory: true,
        variants: [
          {
            title: "Small / Oatmeal",
            sku: "CS-001-S-OAT",
            price: 150.0,
            costPrice: 60.0,
            stockQuantity: 10,
          },
          {
            title: "Medium / Oatmeal",
            sku: "CS-001-M-OAT",
            price: 150.0,
            costPrice: 60.0,
            stockQuantity: 3, // Below low-stock threshold (4) -> Should trigger low stock alert!
          },
        ],
      });

      expect(product).not.toBeNull();
      expect(product?.title).toBe("Cashmere Sweater");
      expect(product?.variants.length).toBe(2);

      productId1 = product!.id;
      variantId1 = product!.variants[0].id;
      variantId2 = product!.variants[1].id;
    });

    it("should detect low-stock status accurately", async () => {
      const fetched = await tenantDb.getProductById(productId1);
      expect(fetched).not.toBeNull();
      expect(fetched?.stockQuantity).toBe(13); // 10 + 3

      // Low stock query filter identifies products with low-stock variants (Medium has 3 <= 4)
      const lowStockList = await tenantDb.getProducts({ lowStockOnly: true });
      expect(lowStockList.items.length).toBe(1);

      // Create a standalone product with 2 units in stock
      const lowStockProduct = await tenantDb.createProduct({
        title: "Limited Edition Brooch",
        sku: "BROOCH-99",
        price: 45.0,
        stockQuantity: 2, // <= lowStockThreshold (5)
        lowStockThreshold: 5,
        trackInventory: true,
      });

      const updatedLowStockList = await tenantDb.getProducts({ lowStockOnly: true });
      expect(updatedLowStockList.items.some((p) => p.id === lowStockProduct?.id)).toBe(true);
    });

    it("should update product metadata and variant prices", async () => {
      const updated = await tenantDb.updateProduct(productId1, {
        title: "Premium Cashmere Sweater",
        price: 165.0,
        variants: [
          {
            id: variantId1,
            title: "Small / Oatmeal",
            sku: "CS-001-S-OAT",
            price: 165.0,
            stockQuantity: 10,
          },
          {
            id: variantId2,
            title: "Medium / Oatmeal",
            sku: "CS-001-M-OAT",
            price: 165.0,
            stockQuantity: 3,
          },
        ],
      });

      expect(updated?.title).toBe("Premium Cashmere Sweater");
      expect(Number(updated?.price)).toBe(165.0);
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 2: Customer CRM & Profiles
  // -------------------------------------------------------------
  describe("Customer CRM & Profiles", () => {
    it("should create a customer profile with tags and contact channels", async () => {
      const customer = await tenantDb.createCustomer({
        name: "Chloe Dupont",
        phone: "+1 555 888 9999",
        email: "chloe@example.com",
        instagramHandle: "@chloedupont",
        address: "100 Broadway, Apt 5A",
        city: "New York",
        notes: "Prefers gift packaging",
        tags: ["VIP", "Instagram Buyer"],
      });

      expect(customer.id).toBeDefined();
      expect(customer.name).toBe("Chloe Dupont");
      expect(customer.tags).toContain("VIP");
      expect(customer.tags).toContain("Instagram Buyer");
      expect(Number(customer.totalSpent)).toBe(0);
      expect(customer.ordersCount).toBe(0);

      customerId1 = customer.id;
    });

    it("should search and filter customers by tag and name", async () => {
      const searchResult = await tenantDb.getCustomers({ search: "Chloe" });
      expect(searchResult.items.length).toBe(1);
      expect(searchResult.items[0].id).toBe(customerId1);

      const tagResult = await tenantDb.getCustomers({ tag: "VIP" });
      expect(tagResult.items.length).toBe(1);
      expect(tagResult.items[0].id).toBe(customerId1);

      const emptyTagResult = await tenantDb.getCustomers({ tag: "NonExistentTag" });
      expect(emptyTagResult.items.length).toBe(0);
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 3: Order Creation, Automatic Calculations & Stock Deduction
  // -------------------------------------------------------------
  describe("Order Creation, Pricing & Inventory Deduction", () => {
    it("should create an order with multiple products and calculate discounts, shipping, tax & total", async () => {
      // Subtotal = 2 * $165.00 = $330.00
      // Discount = $30.00 (FIXED)
      // Shipping = $15.00
      // Tax = $20.00
      // Expected Total = $330 - $30 + $15 + $20 = $335.00
      const order = await tenantDb.createOrder({
        customerId: customerId1,
        source: OrderSource.WHATSAPP,
        status: OrderStatus.CONFIRMED, // Will trigger automatic stock deduction
        paymentStatus: PaymentStatus.PAID,
        discount: 30.0,
        discountType: "FIXED",
        shipping: 15.0,
        tax: 20.0,
        shippingAddress: "100 Broadway, Apt 5A, NY",
        items: [
          {
            productId: productId1,
            variantId: variantId1,
            title: "Premium Cashmere Sweater",
            variantTitle: "Small / Oatmeal",
            quantity: 2,
            unitPrice: 165.0,
          },
        ],
      });

      expect(order.id).toBeDefined();
      expect(order.orderNumber.startsWith("TEST-")).toBe(true);
      expect(Number(order.subtotal)).toBe(330.0);
      expect(Number(order.discount)).toBe(30.0);
      expect(Number(order.shipping)).toBe(15.0);
      expect(Number(order.tax)).toBe(20.0);
      expect(Number(order.totalAmount)).toBe(335.0);
      expect(order.stockDeducted).toBe(true);

      createdOrderId = order.id;

      // Verify variant 1 stock was deducted: was 10, now should be 8!
      const variant1 = await prisma.productVariant.findUnique({ where: { id: variantId1 } });
      expect(variant1?.stockQuantity).toBe(8);

      // Verify customer stats were updated: ordersCount = 1, totalSpent = $335.00
      const updatedCustomer = await tenantDb.getCustomerById(customerId1);
      expect(updatedCustomer?.ordersCount).toBe(1);
      expect(updatedCustomer?.totalSpent).toBe(335.0);
    });

    it("should reject order confirmation if stock is insufficient", async () => {
      // Variant 2 only has 3 in stock. Trying to order 10 should throw InventoryError!
      await expect(
        tenantDb.createOrder({
          customerId: customerId1,
          status: OrderStatus.CONFIRMED,
          items: [
            {
              productId: productId1,
              variantId: variantId2,
              title: "Premium Cashmere Sweater",
              variantTitle: "Medium / Oatmeal",
              quantity: 10, // Exceeds available stock (3)
              unitPrice: 165.0,
            },
          ],
        })
      ).rejects.toThrow(InventoryError);
    });

    it("should create on-the-fly customer if newCustomer payload is provided", async () => {
      const order = await tenantDb.createOrder({
        newCustomer: {
          name: "Direct Walk-in Buyer",
          phone: "+1 555 444 3322",
        },
        source: OrderSource.MANUAL,
        status: OrderStatus.PENDING,
        items: [
          {
            title: "Gift Card",
            quantity: 1,
            unitPrice: 50.0,
          },
        ],
      });

      expect(order.customer).not.toBeNull();
      expect(order.customer?.name).toBe("Direct Walk-in Buyer");
      expect(order.stockDeducted).toBe(false); // Pending order does not deduct stock
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 4: Order Status Management & Automatic Stock Restoration
  // -------------------------------------------------------------
  describe("Order Status Transitions & Stock Restoration", () => {
    it("should automatically restore stock when an order is cancelled", async () => {
      // Before cancellation, variant 1 stock is 8.
      // Order had 2 units of variant 1.
      // Cancelling order should restore stock back to 10!
      const cancelledOrder = await tenantDb.updateOrder(createdOrderId, {
        status: OrderStatus.CANCELLED,
      });

      expect(cancelledOrder.status).toBe(OrderStatus.CANCELLED);
      expect(cancelledOrder.stockDeducted).toBe(false);

      const variant1 = await prisma.productVariant.findUnique({ where: { id: variantId1 } });
      expect(variant1?.stockQuantity).toBe(10);
    });

    it("should re-deduct stock if order is un-cancelled and re-confirmed", async () => {
      const reconfirmedOrder = await tenantDb.updateOrder(createdOrderId, {
        status: OrderStatus.CONFIRMED,
      });

      expect(reconfirmedOrder.status).toBe(OrderStatus.CONFIRMED);
      expect(reconfirmedOrder.stockDeducted).toBe(true);

      const variant1 = await prisma.productVariant.findUnique({ where: { id: variantId1 } });
      expect(variant1?.stockQuantity).toBe(8);
    });
  });

  // -------------------------------------------------------------
  // TEST SUITE 5: Search, Sorting, Filtering & Pagination
  // -------------------------------------------------------------
  describe("Search, Filtering, Sorting & Pagination", () => {
    it("should filter orders by status and search terms", async () => {
      const confirmedOrders = await tenantDb.getOrders({ status: OrderStatus.CONFIRMED });
      expect(confirmedOrders.items.length).toBeGreaterThanOrEqual(1);

      const searched = await tenantDb.getOrders({ search: "Chloe" });
      expect(searched.items.length).toBeGreaterThanOrEqual(1);
    });

    it("should paginate products properly", async () => {
      // Ensure at least two products exist
      await tenantDb.createProduct({
        title: "Pagination Test Item",
        price: 25.0,
      });

      const paginated = await tenantDb.getProducts({ page: 1, limit: 1 });
      expect(paginated.items.length).toBe(1);
      expect(paginated.pagination.page).toBe(1);
      expect(paginated.pagination.limit).toBe(1);
      expect(paginated.pagination.total).toBeGreaterThanOrEqual(2);
      expect(paginated.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });
  });

  afterAll(async () => {
    if (business?.id) {
      await prisma.business.deleteMany({ where: { id: business.id } });
    }
    if (user?.id) {
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });
});
