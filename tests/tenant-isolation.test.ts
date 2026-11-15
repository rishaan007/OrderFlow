import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb, assertBusinessAccess, TenantAccessError } from "../src/lib/tenant";
import { MemberRole, OrderStatus, PaymentStatus, OrderSource } from "@prisma/client";

describe("Phase 1 & 2: Multi-Tenant Business Data Isolation", () => {
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let businessA: { id: string; name: string };
  let businessB: { id: string; name: string };

  beforeAll(async () => {
    // 1. Create two separate merchant users
    userA = await prisma.user.create({
      data: {
        name: "Merchant A",
        email: `tenant.a.${Date.now()}@example.com`,
      },
    });

    userB = await prisma.user.create({
      data: {
        name: "Merchant B",
        email: `tenant.b.${Date.now()}@example.com`,
      },
    });

    // 2. Create Business A for Merchant A
    businessA = await prisma.business.create({
      data: {
        name: "Store Alpha",
        slug: `store-alpha-${Date.now()}`,
        currency: "USD",
        members: {
          create: {
            userId: userA.id,
            role: MemberRole.OWNER,
          },
        },
      },
    });

    // 3. Create Business B for Merchant B
    businessB = await prisma.business.create({
      data: {
        name: "Store Beta",
        slug: `store-beta-${Date.now()}`,
        currency: "EUR",
        members: {
          create: {
            userId: userB.id,
            role: MemberRole.OWNER,
          },
        },
      },
    });

    // 4. Seed unique data for Business A
    const tenantDbA = getTenantDb(businessA.id);
    const customerA = await tenantDbA.createCustomer({
      name: "Alpha Exclusive Customer",
      email: "alpha.cust@example.com",
    });

    const productA = await tenantDbA.createProduct({
      title: "Alpha Exclusive Product",
      price: 100.0,
      stockQuantity: 10,
    });

    await prisma.order.create({
      data: {
        businessId: businessA.id,
        customerId: customerA.id,
        orderNumber: "ALPHA-001",
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        source: OrderSource.WHATSAPP,
        subtotal: 100.0,
        totalAmount: 100.0,
      },
    });

    // 5. Seed unique data for Business B
    const tenantDbB = getTenantDb(businessB.id);
    const customerB = await tenantDbB.createCustomer({
      name: "Beta Secret Buyer",
      email: "beta.cust@example.com",
    });

    await tenantDbB.createProduct({
      title: "Beta Secret Widget",
      price: 50.0,
      stockQuantity: 5,
    });

    await prisma.order.create({
      data: {
        businessId: businessB.id,
        customerId: customerB.id,
        orderNumber: "BETA-001",
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        source: OrderSource.INSTAGRAM,
        subtotal: 50.0,
        totalAmount: 50.0,
      },
    });
  });

  it("should assert user access correctly per business", async () => {
    // User A should have access to Business A
    const membershipA = await assertBusinessAccess(userA.id, businessA.id);
    expect(membershipA.role).toBe(MemberRole.OWNER);

    // User B should have access to Business B
    const membershipB = await assertBusinessAccess(userB.id, businessB.id);
    expect(membershipB.role).toBe(MemberRole.OWNER);

    // User A should NOT have access to Business B
    await expect(assertBusinessAccess(userA.id, businessB.id)).rejects.toThrow(
      TenantAccessError
    );

    // User B should NOT have access to Business A
    await expect(assertBusinessAccess(userB.id, businessA.id)).rejects.toThrow(
      TenantAccessError
    );
  });

  it("should strictly isolate customer records between tenants", async () => {
    const tenantDbA = getTenantDb(businessA.id);
    const tenantDbB = getTenantDb(businessB.id);

    const customersA = await tenantDbA.getCustomers();
    const customersB = await tenantDbB.getCustomers();

    expect(customersA.items.length).toBe(1);
    expect(customersA.items[0].name).toBe("Alpha Exclusive Customer");

    expect(customersB.items.length).toBe(1);
    expect(customersB.items[0].name).toBe("Beta Secret Buyer");

    // Cross-tenant ID lookup must return null
    const leakedLookup = await tenantDbA.getCustomerById(customersB.items[0].id);
    expect(leakedLookup).toBeNull();
  });

  it("should strictly isolate product records between tenants", async () => {
    const tenantDbA = getTenantDb(businessA.id);
    const tenantDbB = getTenantDb(businessB.id);

    const productsA = await tenantDbA.getProducts();
    const productsB = await tenantDbB.getProducts();

    expect(productsA.items.length).toBe(1);
    expect(productsA.items[0].title).toBe("Alpha Exclusive Product");

    expect(productsB.items.length).toBe(1);
    expect(productsB.items[0].title).toBe("Beta Secret Widget");

    // Cross-tenant ID lookup must return null
    const leakedProduct = await tenantDbA.getProductById(productsB.items[0].id);
    expect(leakedProduct).toBeNull();
  });

  it("should strictly isolate orders and dashboard metrics", async () => {
    const tenantDbA = getTenantDb(businessA.id);
    const tenantDbB = getTenantDb(businessB.id);

    const ordersA = await tenantDbA.getOrders();
    const ordersB = await tenantDbB.getOrders();

    expect(ordersA.items.length).toBe(1);
    expect(ordersA.items[0].orderNumber).toBe("ALPHA-001");

    expect(ordersB.items.length).toBe(1);
    expect(ordersB.items[0].orderNumber).toBe("BETA-001");

    // Cross-tenant order lookup must return null
    const leakedOrder = await tenantDbA.getOrderById(ordersB.items[0].id);
    expect(leakedOrder).toBeNull();

    // Verify isolated dashboard stats calculation
    const statsA = await tenantDbA.getDashboardStats();
    const statsB = await tenantDbB.getDashboardStats();

    expect(statsA.metrics.totalRevenue.value).toBe(100);
    expect(statsA.metrics.totalOrders.value).toBe(1);
    expect(statsA.recentOrders[0].orderNumber).toBe("ALPHA-001");

    expect(statsB.metrics.totalRevenue.value).toBe(0);
    expect(statsB.metrics.totalOrders.value).toBe(1);
    expect(statsB.recentOrders[0].orderNumber).toBe("BETA-001");
  });

  afterAll(async () => {
    // Cleanup
    await prisma.business.deleteMany({
      where: { id: { in: [businessA.id, businessB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
  });
});
