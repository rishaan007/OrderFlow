// Phase 4 Payment Tests
import { describe, it, expect, beforeAll } from "vitest";
import { getTenantDb } from "../src/lib/tenant";
import { prisma } from "../src/lib/prisma";
import { PaymentMethod, PaymentRecordStatus } from "@prisma/client";

let businessId: string;
let tenant: ReturnType<typeof getTenantDb>;

beforeAll(async () => {
  const business = await prisma.business.findFirst();
  if (!business) throw new Error("No business found");
  businessId = business.id;
  tenant = getTenantDb(businessId);
});

describe("Payment workflow", () => {
  it("records pending payment without affecting amountPaid", async () => {
    const order = await prisma.order.create({
      data: {
        businessId,
        orderNumber: `ORD-TEST-1-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        subtotal: 100,
        totalAmount: 100,
        status: "PENDING",
        paymentStatus: "PENDING",
      },
    });
    const payment = await tenant.recordPayment(order.id, {
      amount: 50,
      method: PaymentMethod.UPI,
      referenceNumber: "REF123",
    });
    expect(payment.status).toBe(PaymentRecordStatus.PENDING_VERIFICATION);
    const refreshed = await tenant.getOrderById(order.id);
    expect(refreshed?.amountPaid).toBe(0);
  });

  it("verifies payment and updates order amountPaid", async () => {
    const order = await prisma.order.create({
      data: {
        businessId,
        orderNumber: `ORD-TEST-2-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        subtotal: 200,
        totalAmount: 200,
        status: "PENDING",
        paymentStatus: "PENDING",
      },
    });
    const payment = await tenant.recordPayment(order.id, {
      amount: 150,
      method: PaymentMethod.CASH,
      referenceNumber: "CASH1",
    });
    const verified = await tenant.verifyPayment(payment.id, {
      action: "VERIFY",
    });
    expect(verified.status).toBe(PaymentRecordStatus.VERIFIED);
    const refreshed = await tenant.getOrderById(order.id);
    expect(refreshed?.amountPaid).toBe(150);
    const outstanding = (refreshed?.totalAmount ?? 0) - (refreshed?.amountPaid ?? 0);
    expect(outstanding).toBe(50);
  });

  it("handles multiple partial payments correctly", async () => {
    const order = await prisma.order.create({
      data: {
        businessId,
        orderNumber: `ORD-TEST-3-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        subtotal: 300,
        totalAmount: 300,
        status: "PENDING",
        paymentStatus: "PENDING",
      },
    });
    await tenant.recordPayment(order.id, {
      amount: 100,
      method: PaymentMethod.UPI,
      referenceNumber: "P1",
    });
    await tenant.recordPayment(order.id, {
      amount: 100,
      method: PaymentMethod.CASH,
      referenceNumber: "P2",
    });
    const result = await tenant.getPayments(order.id);
    expect(result.items).toHaveLength(2);
    for (const p of result.items) {
      await tenant.verifyPayment(p.id, { action: "VERIFY" });
    }
    const refreshed = await tenant.getOrderById(order.id);
    expect(refreshed?.amountPaid).toBe(200);
    expect(refreshed?.paymentStatus).toBe("PARTIALLY_PAID");
  });
});
