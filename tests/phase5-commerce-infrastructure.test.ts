import crypto from "crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import {
  OrderStatus,
  PaymentStatus,
  PaymentProvider,
  PaymentIntentStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  RefundStatus,
  RefundType,
  ReturnStatus,
  ReturnReason,
  ShipmentStatus,
  FulfillmentStatus,
  DeliveryPartner,
  LedgerEntryType,
  LedgerDirection,
  ReconciliationStatus,
  ReconciliationType,
  EvidenceType,
} from "@prisma/client";
import {
  toMinorUnits,
  minorUnitsToMajorString,
  calculateOrderTotalsMinorUnits,
  calculatePercentageMinorUnits,
} from "../src/lib/money";
import {
  InvalidStateTransitionError,
  IdempotencyConflictError,
  PaymentError,
  RefundError,
  ReturnError,
  WebhookVerificationError,
  NotFoundError,
} from "../src/lib/errors";
import {
  assertValidTransition,
  PAYMENT_INTENT_TRANSITIONS,
  REFUND_TRANSITIONS,
  RETURN_TRANSITIONS,
  SHIPMENT_TRANSITIONS,
} from "../src/lib/state-machines";
import {
  createPaymentIntent,
  attemptPaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  getPaymentIntentById,
} from "../src/lib/payment-intents";
import {
  requestRefund,
  processRefund,
  getRefundById,
} from "../src/lib/refunds";
import {
  createReturnRequest,
  updateReturnStatus,
  receiveAndInspectReturn,
  getReturnById,
} from "../src/lib/returns";
import {
  getOrderLedgerBalance,
  validateLedgerInvariants,
  createCompensatingEntry,
} from "../src/lib/ledger";
import {
  createOrchestratedShipment,
  generateShipmentLabel,
  recordTrackingEvent,
  getShipmentTrackingHistory,
} from "../src/lib/shipping-provider";
import {
  reconcilePayments,
  reconcileRefunds,
  reconcileShipments,
  resolveReconciliationEntry,
  getReconciliationRunById,
} from "../src/lib/reconciliation";
import {
  upsertPaymentProviderConfig,
  getPaymentProviderConfigs,
} from "../src/lib/payment-provider";
import {
  processPaymentWebhook,
  processLogisticsWebhook,
} from "../src/lib/commerce-webhooks";
import { getPublicTransactionByToken } from "../src/lib/transactions";
import { assessTransactionRisk } from "../src/lib/risk-engine";

let tenantAId: string;
let tenantBId: string;
let tenantA: ReturnType<typeof getTenantDb>;
let tenantB: ReturnType<typeof getTenantDb>;
let userAId: string;
let productAId: string;
let customerAId: string;

beforeAll(async () => {
  const ts = Date.now();
  const bA = await prisma.business.create({
    data: {
      name: "Phase 5 Commerce Tenant A",
      slug: `phase5-commerce-a-${ts}`,
      currency: "USD",
      plan: "ENTERPRISE",
      monthlyOrderLimit: 10000,
    },
  });
  const bB = await prisma.business.create({
    data: {
      name: "Phase 5 Commerce Tenant B",
      slug: `phase5-commerce-b-${ts}`,
      currency: "USD",
      plan: "ENTERPRISE",
      monthlyOrderLimit: 10000,
    },
  });

  tenantAId = bA.id;
  tenantBId = bB.id;
  tenantA = getTenantDb(tenantAId);
  tenantB = getTenantDb(tenantBId);

  const uA = await prisma.user.create({
    data: {
      email: `p5_merchant_a_${ts}@example.com`,
      name: "Phase 5 Merchant A",
    },
  });
  userAId = uA.id;

  const prod = await tenantA.createProduct({
    title: "Ceramic Pour-Over Set",
    sku: `CPO-${ts}`,
    price: 49.99,
    stockQuantity: 50,
    trackInventory: true,
  });
  productAId = prod.id;

  const cust = await tenantA.createCustomer({
    name: "Elena Buyer",
    email: `elena_${ts}@example.com`,
    phone: "+15550001234",
    address: "123 Artisan Way, Portland",
  });
  customerAId = cust.id;
});

describe("Phase 5: Integer Minor-Unit Money & Zero Floating-Point Drift", () => {
  it("converts tricky decimal strings without IEEE-754 drift (19.99 USD === 1999)", () => {
    expect(toMinorUnits("19.99", "USD")).toBe(1999);
    expect(toMinorUnits(19.99, "USD")).toBe(1999);
    expect(minorUnitsToMajorString(1999, "USD")).toBe("19.99");
    expect(toMinorUnits(1000, "JPY")).toBe(1000);
    expect(toMinorUnits("1.234", "KWD")).toBe(1234);
    expect(minorUnitsToMajorString(1234, "KWD")).toBe("1.234");
  });

  it("rejects sub-minor-unit precision and non-integer minor units cleanly", () => {
    expect(() => toMinorUnits("12.5", "JPY")).toThrow();
    expect(() => toMinorUnits("10.999", "USD")).toThrow();
    expect(() => calculatePercentageMinorUnits(1000, 150)).toThrow();
  });

  it("computes exact order totals in minor units (2 x $19.99 - 10% + $5 shipping = $40.98)", () => {
    const totals = calculateOrderTotalsMinorUnits({
      items: [{ quantity: 2, unitPrice: 19.99 }],
      discount: 10,
      discountType: "PERCENTAGE",
      shipping: 5,
      tax: 0,
      currency: "USD",
    });
    expect(totals.subtotalMinorUnits).toBe(3998);
    expect(totals.discountMinorUnits).toBe(400); // 10% of 3998 = 399.8 -> round half up 400
    expect(totals.shippingMinorUnits).toBe(500);
    expect(totals.totalMinorUnits).toBe(4098);
  });
});

describe("Phase 5: State Machine Enforcement", () => {
  it("rejects impossible state transitions across Payments, Refunds, Returns, and Shipments", () => {
    expect(() =>
      assertValidTransition(
        "PaymentIntent",
        PAYMENT_INTENT_TRANSITIONS,
        PaymentIntentStatus.CAPTURED,
        PaymentIntentStatus.AUTHORIZED
      )
    ).toThrow(InvalidStateTransitionError);

    expect(() =>
      assertValidTransition(
        "Refund",
        REFUND_TRANSITIONS,
        RefundStatus.COMPLETED,
        RefundStatus.REQUESTED
      )
    ).toThrow(InvalidStateTransitionError);

    expect(() =>
      assertValidTransition(
        "ReturnRequest",
        RETURN_TRANSITIONS,
        ReturnStatus.REJECTED,
        ReturnStatus.APPROVED
      )
    ).toThrow(InvalidStateTransitionError);

    expect(() =>
      assertValidTransition(
        "Shipment",
        SHIPMENT_TRANSITIONS,
        ShipmentStatus.CREATED,
        ShipmentStatus.DELIVERED
      )
    ).toThrow(InvalidStateTransitionError);

    expect(() =>
      assertValidTransition(
        "Shipment",
        SHIPMENT_TRANSITIONS,
        ShipmentStatus.DELIVERED,
        ShipmentStatus.IN_TRANSIT
      )
    ).toThrow(InvalidStateTransitionError);
  });
});

describe("Phase 5: Payment Intents, Attempts, Partial Capture, Idempotency & Risk Integration", () => {
  let orderId: string;
  let intentId: string;

  it("creates order with frozen returnPolicy and creates idempotent PaymentIntent", async () => {
    const order = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.CONFIRMED,
      items: [
        {
          productId: productAId,
          title: "Ceramic Pour-Over Set",
          quantity: 2,
          unitPrice: 49.99,
        },
      ],
      shipping: 10.02, // 99.98 + 10.02 = 110.00 -> 11000 minor units
    });
    orderId = order.id;

    expect(Number(order.totalAmount)).toBe(110);
    expect(order.fulfillmentStatus).toBe(FulfillmentStatus.UNFULFILLED);
    expect(order.returnPolicy).toBeDefined();

    const idemKey = `intent-${orderId}-1`;
    const pi1 = await createPaymentIntent(
      tenantAId,
      {
        orderId,
        provider: PaymentProvider.RAZORPAY,
        amountMinorUnits: 11000,
        currency: "USD",
        idempotencyKey: idemKey,
      },
      userAId
    );
    intentId = pi1.id;

    expect(pi1.status).toBe(PaymentIntentStatus.CREATED);
    expect(pi1.amountMinorUnits).toBe(11000);
    expect(pi1.providerOrderId).toBeTruthy();

    // Exact replay with same idempotencyKey returns existing intent
    const piReplay = await createPaymentIntent(
      tenantAId,
      {
        orderId,
        provider: PaymentProvider.RAZORPAY,
        amountMinorUnits: 11000,
        currency: "USD",
        idempotencyKey: idemKey,
      },
      userAId
    );
    expect(piReplay.id).toBe(pi1.id);

    // Reusing same key with different amount fails with IdempotencyConflictError
    await expect(
      createPaymentIntent(
        tenantAId,
        {
          orderId,
          provider: PaymentProvider.RAZORPAY,
          amountMinorUnits: 5000,
          currency: "USD",
          idempotencyKey: idemKey,
        },
        userAId
      )
    ).rejects.toThrow(IdempotencyConflictError);

    // Rejects mismatched currency and amount > remaining balance
    await expect(
      createPaymentIntent(tenantAId, {
        orderId,
        currency: "EUR",
        idempotencyKey: `bad-curr-${orderId}`,
      })
    ).rejects.toThrow(PaymentError);

    await expect(
      createPaymentIntent(tenantAId, {
        orderId,
        amountMinorUnits: 20000,
        currency: "USD",
        idempotencyKey: `over-pay-${orderId}`,
      })
    ).rejects.toThrow(PaymentError);
  });

  it("tracks immutable failed and authorized PaymentAttempts and propagates PAYMENT_FAILED into risk", async () => {
    // Failed attempt #1
    const failedRes = await attemptPaymentIntent(
      tenantAId,
      intentId,
      {
        method: PaymentMethod.RAZORPAY,
        idempotencyKey: `att-fail-${intentId}`,
        simulateFailure: true,
        failureCode: "INSUFFICIENT_FUNDS",
        failureReason: "Card declined by issuer",
      },
      userAId
    );
    expect(failedRes.attempt.status).toBe(PaymentAttemptStatus.FAILED);
    expect(failedRes.attempt.attemptNumber).toBe(1);
    expect(failedRes.intent.status).toBe(PaymentIntentStatus.FAILED);

    // Verify risk engine detects the failed attempt cleanly
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { socialTransaction: true },
    });
    const risk = await assessTransactionRisk(order!.socialTransaction!.id);
    expect(risk.reasons.some((r) => r.code === "PAYMENT_FAILED")).toBe(true);

    // Retry attempt #2 succeeds with AUTHORIZED
    const authRes = await attemptPaymentIntent(
      tenantAId,
      intentId,
      {
        method: PaymentMethod.RAZORPAY,
        idempotencyKey: `att-auth-${intentId}`,
        autoCapture: false,
      },
      userAId
    );
    expect(authRes.attempt.status).toBe(PaymentAttemptStatus.AUTHORIZED);
    expect(authRes.attempt.attemptNumber).toBe(2);
    expect(authRes.intent.status).toBe(PaymentIntentStatus.AUTHORIZED);

    const loaded = await getPaymentIntentById(tenantAId, intentId);
    expect(loaded.attempts).toHaveLength(2);
    expect(loaded.attempts[0].status).toBe(PaymentAttemptStatus.FAILED);
    expect(loaded.attempts[1].status).toBe(PaymentAttemptStatus.AUTHORIZED);
  });

  it("supports partial then final capture with exact ledger & order balance synchronization", async () => {
    // Capture 6000 minor units ($60.00)
    const partialCap = await capturePaymentIntent(
      tenantAId,
      intentId,
      {
        amountMinorUnits: 6000,
        idempotencyKey: `cap-1-${intentId}`,
      },
      userAId
    );
    expect(partialCap.intent.status).toBe(PaymentIntentStatus.PARTIALLY_CAPTURED);
    expect(partialCap.intent.capturedMinorUnits).toBe(6000);

    let refreshedOrder = await tenantA.getOrderById(orderId);
    expect(refreshedOrder?.paymentStatus).toBe(PaymentStatus.PARTIALLY_PAID);
    expect(refreshedOrder?.amountPaid).toBe(60);
    expect(refreshedOrder?.outstandingBalance).toBe(50);

    // Over-capture (> 5000 remaining) must fail
    await expect(
      capturePaymentIntent(tenantAId, intentId, {
        amountMinorUnits: 6000,
        idempotencyKey: `cap-over-${intentId}`,
      })
    ).rejects.toThrow(PaymentError);

    // Capture remaining 5000 ($50.00)
    const finalCap = await capturePaymentIntent(
      tenantAId,
      intentId,
      {
        amountMinorUnits: 5000,
        idempotencyKey: `cap-2-${intentId}`,
      },
      userAId
    );
    expect(finalCap.intent.status).toBe(PaymentIntentStatus.CAPTURED);
    expect(finalCap.intent.capturedMinorUnits).toBe(11000);

    refreshedOrder = await tenantA.getOrderById(orderId);
    expect(refreshedOrder?.paymentStatus).toBe(PaymentStatus.PAID);
    expect(refreshedOrder?.amountPaid).toBe(110);
    expect(refreshedOrder?.outstandingBalance).toBe(0);

    // Ledger balance invariant check
    const balance = await getOrderLedgerBalance(tenantAId, orderId);
    expect(balance.capturedMinorUnits).toBe(11000);
    expect(balance.netBalanceMinorUnits).toBe(11000);
    expect(balance.isDoubleEntryBalanced).toBe(true);
    expect(balance.totalDebitsMinorUnits).toBe(balance.totalCreditsMinorUnits);

    const inv = await validateLedgerInvariants(tenantAId, orderId);
    expect(inv.valid).toBe(true);
    expect(inv.violations).toHaveLength(0);
  });
});

describe("Phase 5: Partial & Full Refunds, Over-Refund Guard & Ledger Reversals", () => {
  let orderId: string;
  let intentId: string;

  beforeAll(async () => {
    const order = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.DELIVERED,
      items: [{ productId: productAId, title: "Ceramic Pour-Over Set", quantity: 1, unitPrice: 100 }],
    });
    orderId = order.id;

    const intent = await createPaymentIntent(tenantAId, {
      orderId,
      provider: PaymentProvider.MANUAL,
      amountMinorUnits: 10000,
      currency: "USD",
      idempotencyKey: `pi-ref-base-${orderId}`,
    });
    intentId = intent.id;

    await attemptPaymentIntent(tenantAId, intentId, {
      method: PaymentMethod.UPI,
      idempotencyKey: `att-ref-base-${orderId}`,
      autoCapture: true,
    });
  });

  it("issues partial refund, enforces over-refund & currency & idempotency invariants, then completes remaining refund", async () => {
    // 1. Partial refund $40.00 (4000)
    const ref1 = await requestRefund(
      tenantAId,
      {
        orderId,
        paymentIntentId: intentId,
        amountMinorUnits: 4000,
        currency: "USD",
        reason: "Partial goodwill credit",
        idempotencyKey: `ref1-${orderId}`,
        processImmediately: true,
      },
      userAId
    );
    expect(ref1.status).toBe(RefundStatus.COMPLETED);
    expect(ref1.amountMinorUnits).toBe(4000);

    // Duplicate idempotencyKey returns existing refund safely
    const ref1Dup = await requestRefund(tenantAId, {
      orderId,
      paymentIntentId: intentId,
      amountMinorUnits: 4000,
      currency: "USD",
      reason: "Partial goodwill credit",
      idempotencyKey: `ref1-${orderId}`,
    });
    expect(ref1Dup.id).toBe(ref1.id);

    // Over-refund rejected (remaining is 6000, asking 7000)
    await expect(
      requestRefund(tenantAId, {
        orderId,
        paymentIntentId: intentId,
        amountMinorUnits: 7000,
        currency: "USD",
        reason: "Excessive refund attempt",
        idempotencyKey: `ref-over-${orderId}`,
      })
    ).rejects.toThrow(RefundError);

    // Currency mismatch rejected
    await expect(
      requestRefund(tenantAId, {
        orderId,
        paymentIntentId: intentId,
        amountMinorUnits: 1000,
        currency: "EUR",
        reason: "Wrong currency",
        idempotencyKey: `ref-curr-${orderId}`,
      })
    ).rejects.toThrow(RefundError);

    // Check ledger net balance = 10000 - 4000 = 6000
    let balance = await getOrderLedgerBalance(tenantAId, orderId);
    expect(balance.capturedMinorUnits).toBe(10000);
    expect(balance.refundedMinorUnits).toBe(4000);
    expect(balance.netBalanceMinorUnits).toBe(6000);
    expect(balance.isDoubleEntryBalanced).toBe(true);

    // Final remaining refund $60.00 (6000)
    const ref2 = await requestRefund(
      tenantAId,
      {
        orderId,
        paymentIntentId: intentId,
        amountMinorUnits: 6000,
        currency: "USD",
        reason: "Remaining refund",
        idempotencyKey: `ref2-${orderId}`,
        processImmediately: true,
      },
      userAId
    );
    expect(ref2.status).toBe(RefundStatus.COMPLETED);

    const updatedOrder = await prisma.order.findUnique({ where: { id: orderId } });
    expect(updatedOrder?.paymentStatus).toBe(PaymentStatus.REFUNDED);
    expect(updatedOrder?.refundedAmountMinorUnits).toBe(10000);

    const updatedIntent = await getPaymentIntentById(tenantAId, intentId);
    expect(updatedIntent.status).toBe(PaymentIntentStatus.REFUNDED);

    balance = await getOrderLedgerBalance(tenantAId, orderId);
    expect(balance.netBalanceMinorUnits).toBe(0);
    expect(balance.isDoubleEntryBalanced).toBe(true);
  });

  it("blocks concurrent double-refund race conditions via transactional balance locking & invariants", async () => {
    const order = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.DELIVERED,
      items: [{ title: "Concurrency Mug", quantity: 1, unitPrice: 50 }],
    });
    const intent = await createPaymentIntent(tenantAId, {
      orderId: order.id,
      provider: PaymentProvider.MANUAL,
      amountMinorUnits: 5000,
      currency: "USD",
      idempotencyKey: `race-pi-${order.id}`,
    });
    await attemptPaymentIntent(tenantAId, intent.id, {
      idempotencyKey: `race-att-${order.id}`,
      autoCapture: true,
    });

    // Two concurrent $40 refunds with different idempotency keys against $50 captured
    const settled = await Promise.allSettled([
      requestRefund(tenantAId, {
        orderId: order.id,
        paymentIntentId: intent.id,
        amountMinorUnits: 4000,
        reason: "Concurrent refund A",
        idempotencyKey: `race-ref-a-${order.id}`,
      }),
      requestRefund(tenantAId, {
        orderId: order.id,
        paymentIntentId: intent.id,
        amountMinorUnits: 4000,
        reason: "Concurrent refund B",
        idempotencyKey: `race-ref-b-${order.id}`,
      }),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    const refundsInDb = await prisma.refund.findMany({ where: { orderId: order.id } });
    const sumRefunded = refundsInDb.reduce((s, r) => s + r.amountMinorUnits, 0);
    expect(sumRefunded).toBe(4000);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it("supports compensating ledger reversal without mutating historical entries", async () => {
    const order = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.CONFIRMED,
      items: [{ title: "Misc Item", quantity: 1, unitPrice: 25 }],
    });
    const payment = await tenantA.recordPayment(
      order.id,
      { amount: 25, method: PaymentMethod.CASH, verifiedImmediately: true },
      userAId
    );
    const ledger = await tenantA.getLedgerEntries({ orderId: order.id });
    expect(ledger.items).toHaveLength(2); // DEBIT + CREDIT pair
    const origEntry = ledger.items.find((e) => e.account === "ORDER_RECEIVABLE")!;

    const reversals = await createCompensatingEntry(
      tenantAId,
      origEntry.id,
      "Reversed erroneous duplicate manual cash entry",
      { idempotencyKey: `rev-${origEntry.id}`, actorId: userAId }
    );
    expect(reversals).toHaveLength(2);
    expect(reversals.every((r) => r.entryType === LedgerEntryType.REVERSAL)).toBe(true);

    // Original entry untouched
    const origAfter = await prisma.ledgerEntry.findUnique({ where: { id: origEntry.id } });
    expect(origAfter?.amountMinorUnits).toBe(2500);
    expect(origAfter?.direction).toBe(LedgerDirection.CREDIT);

    const balance = await getOrderLedgerBalance(tenantAId, order.id);
    expect(balance.netBalanceMinorUnits).toBe(0);
    expect(balance.isDoubleEntryBalanced).toBe(true);
  });
});

describe("Phase 5: Return Requests, Eligibility, Inspection, Restocking & Transaction Room", () => {
  it("handles full return lifecycle with partial items, restocking, refund issuance, and sanitized buyer view", async () => {
    const stockBefore = (await tenantA.getProductById(productAId))!.stockQuantity;
    const order = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.DELIVERED,
      shippingAddress: "123 Artisan Way, Portland",
      items: [{ productId: productAId, title: "Ceramic Pour-Over Set", quantity: 3, unitPrice: 50 }],
    });

    await tenantA.recordPayment(
      order.id,
      { amount: 150, method: PaymentMethod.UPI, verifiedImmediately: true },
      userAId
    );

    const orderItem = (await tenantA.getOrderById(order.id))!.items[0];

    // 1. Request partial return for 2 of 3 items
    const ret = await createReturnRequest(tenantAId, {
      orderId: order.id,
      reason: ReturnReason.DAMAGED_ITEM,
      buyerNotes: "2 cups arrived chipped",
      items: [{ orderItemId: orderItem.id, quantity: 2 }],
    });

    expect(ret.status).toBe(ReturnStatus.REQUESTED);
    expect(ret.requestedAmountMinorUnits).toBe(10000); // 2 * $50 = $100
    expect((ret.eligibilityResult as any).eligible).toBe(true);

    // Cannot request another return for 2 more (only 1 remaining)
    await expect(
      createReturnRequest(tenantAId, {
        orderId: order.id,
        reason: ReturnReason.WRONG_ITEM,
        items: [{ orderItemId: orderItem.id, quantity: 2 }],
      })
    ).rejects.toThrow(ReturnError);

    // 2. Approve & create label
    await updateReturnStatus(
      tenantAId,
      ret.id,
      { status: ReturnStatus.APPROVED, sellerResponse: "Approved for warehouse inspection" },
      userAId
    );
    const labelRes = await updateReturnStatus(
      tenantAId,
      ret.id,
      { status: ReturnStatus.LABEL_CREATED, carrier: DeliveryPartner.SHIPROCKET },
      userAId
    );
    expect(labelRes.returnRequest.trackingNumber).toContain("RET-");

    // 3. Receive, inspect (pass), restock (+2 units), and auto-refund ($100)
    const inspectedRes = await receiveAndInspectReturn(
      tenantAId,
      ret.id,
      {
        inspectionPassed: true,
        inspectionNotes: "Confirmed chip damage; units restocked",
        restockInventory: true,
        issueRefund: true,
      },
      userAId
    );

    expect(inspectedRes.refund).not.toBeNull();
    expect(inspectedRes.refund!.status).toBe(RefundStatus.COMPLETED);
    expect(inspectedRes.refund!.type).toBe(RefundType.RETURN_REFUND);
    expect(inspectedRes.refund!.amountMinorUnits).toBe(10000);

    const finalReturn = await getReturnById(tenantAId, ret.id);
    expect(finalReturn.status).toBe(ReturnStatus.REFUNDED);

    // Stock: started stockBefore -> ordered 3 (-3) -> restocked 2 = stockBefore - 1
    const stockAfter = (await tenantA.getProductById(productAId))!.stockQuantity;
    expect(stockAfter).toBe(stockBefore - 1);

    // Verify public transaction room projection exposes buyer-safe financials, returns, and refunds
    const socialTx = await prisma.socialTransaction.findUnique({ where: { orderId: order.id } });
    const room = await getPublicTransactionByToken(socialTx!.publicTrackingToken);
    expect(room?.order?.refunds).toHaveLength(1);
    expect(room?.order?.returns).toHaveLength(1);
    expect(room?.order?.returns?.[0].status).toBe(ReturnStatus.REFUNDED);
    expect(room?.order?.refundedAmount).toBe(100);
    expect((room as any).sellerNotes).toBeUndefined();
  });
});

describe("Phase 5: Logistics Provider Abstraction, Labels, Tracking & Webhooks", () => {
  let orderId: string;
  let shipmentId: string;
  let trackingNumber: string;

  beforeAll(async () => {
    const order = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.CONFIRMED,
      shippingAddress: "742 Logistics Blvd, Austin",
      items: [{ title: "Espresso Tamper", quantity: 1, unitPrice: 40 }],
    });
    orderId = order.id;
  });

  it("orchestrates shipment + label creation and processes signed carrier tracking webhooks with dedup", async () => {
    const created = await createOrchestratedShipment(tenantAId, {
      orderId,
      carrier: DeliveryPartner.SHIPROCKET,
      shippingAddress: "742 Logistics Blvd, Austin",
      generateLabel: true,
    });
    shipmentId = created.id;
    trackingNumber = created.trackingNumber!;

    expect(created.status).toBe(ShipmentStatus.LABEL_CREATED);
    expect(created.label?.labelReference).toContain("LBL-");

    // Repeated label call returns existing label cleanly
    const sameLabel = await generateShipmentLabel(tenantAId, shipmentId);
    expect(sameLabel.labelReference).toBe(created.label?.labelReference);

    // Reject unsigned logistics webhook
    const whPayload = JSON.stringify({
      eventId: `ship_ev_1_${Date.now()}`,
      awb: trackingNumber,
      current_status: "IN_TRANSIT",
      location: "Dallas Hub",
      occurredAt: new Date().toISOString(),
    });
    await expect(
      processLogisticsWebhook({
        provider: "SHIPROCKET",
        rawBody: whPayload,
        signature: "bad_sig",
        webhookSecretOverride: "ship_secret_123",
      })
    ).rejects.toThrow(WebhookVerificationError);

    // Valid signed IN_TRANSIT webhook
    const validSig = crypto
      .createHmac("sha256", "ship_secret_123")
      .update(whPayload)
      .digest("hex");

    const processed = await processLogisticsWebhook({
      provider: "SHIPROCKET",
      rawBody: whPayload,
      signature: validSig,
      webhookSecretOverride: "ship_secret_123",
    });
    expect(processed.status).toBe("PROCESSED");
    expect(processed.shipmentStatus).toBe(ShipmentStatus.IN_TRANSIT);

    // Replay same webhook eventId -> deduplicated idempotently
    const dup = await processLogisticsWebhook({
      provider: "SHIPROCKET",
      rawBody: whPayload,
      signature: validSig,
      webhookSecretOverride: "ship_secret_123",
    });
    expect(dup.status).toBe("DUPLICATE");

    // Progress shipment to DELIVERED
    await recordTrackingEvent(tenantAId, shipmentId, {
      provider: "SHIPROCKET",
      providerEventId: `ship_ev_deliv_${Date.now()}`,
      status: ShipmentStatus.DELIVERED,
      description: "Signed at front door",
      location: "Austin TX",
    });

    const history = await getShipmentTrackingHistory(tenantAId, shipmentId);
    expect(history.status).toBe(ShipmentStatus.DELIVERED);
    expect(history.trackingEvents.length).toBeGreaterThanOrEqual(3);

    const refreshedOrder = await tenantA.getOrderById(orderId);
    expect(refreshedOrder?.status).toBe(OrderStatus.DELIVERED);
    expect(refreshedOrder?.fulfillmentStatus).toBe(FulfillmentStatus.DELIVERED);

    // Transaction room carries tracking events & evidence
    const st = await prisma.socialTransaction.findUnique({ where: { orderId } });
    const room = await getPublicTransactionByToken(st!.publicTrackingToken);
    expect(room?.order?.shipment?.latestEvent?.status).toBe(ShipmentStatus.DELIVERED);
    expect(room?.evidence.some((e) => e.evidenceType === EvidenceType.DELIVERY_CONFIRMATION)).toBe(true);
  });
});

describe("Phase 5: Payment Provider Config Security, Webhooks & Reconciliation", () => {
  const stripeWebhookSecret = "whsec_test_phase5_987654321";

  it("encrypts payment provider credentials and never leaks secrets", async () => {
    const cfg = await upsertPaymentProviderConfig(tenantAId, {
      provider: PaymentProvider.STRIPE,
      environment: "sandbox",
      accountIdentifier: `acct_test_${tenantAId.slice(0, 8)}`,
      credentials: {
        keyId: "pk_test_12345",
        keySecret: "sk_test_super_secret",
        webhookSecret: stripeWebhookSecret,
      },
    });
    expect(cfg.hasCredentials).toBe(true);
    expect((cfg as any).encryptedCredentials).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toContain("sk_test_super_secret");
    expect(JSON.stringify(cfg)).not.toContain(stripeWebhookSecret);

    const list = await getPaymentProviderConfigs(tenantAId);
    expect(JSON.stringify(list)).not.toContain("sk_test_super_secret");
  });

  it("verifies Stripe webhook signatures, rejects replays, deduplicates events, and reconciles discrepancies", async () => {
    const order = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.CONFIRMED,
      items: [{ title: "Stripe Checkout Item", quantity: 1, unitPrice: 75 }],
    });

    const intent = await createPaymentIntent(tenantAId, {
      orderId: order.id,
      provider: PaymentProvider.STRIPE,
      amountMinorUnits: 7500,
      currency: "USD",
      idempotencyKey: `stripe-pi-${order.id}`,
    });

    const tsSec = Math.floor(Date.now() / 1000);
    const eventId = `evt_stripe_${Date.now()}`;
    const stripeBody = JSON.stringify({
      id: eventId,
      type: "payment_intent.succeeded",
      created: tsSec,
      account: `acct_test_${tenantAId.slice(0, 8)}`,
      data: {
        object: {
          id: intent.providerOrderId,
          object: "payment_intent",
          amount_received: 7500,
          currency: "usd",
          latest_charge: `ch_${Date.now()}`,
          metadata: { businessId: tenantAId, orderId: order.id },
        },
      },
    });

    const sigHex = crypto
      .createHmac("sha256", stripeWebhookSecret)
      .update(`${tsSec}.${stripeBody}`)
      .digest("hex");
    const stripeHeader = `t=${tsSec},v1=${sigHex}`;

    // Invalid signature must fail BEFORE updating state
    await expect(
      processPaymentWebhook({
        provider: PaymentProvider.STRIPE,
        rawBody: stripeBody,
        signature: `t=${tsSec},v1=deadbeef`,
      })
    ).rejects.toThrow(WebhookVerificationError);

    // Expired timestamp replay must be rejected
    const staleTs = tsSec - 3600;
    const staleBody = JSON.stringify({
      ...JSON.parse(stripeBody),
      id: `evt_stale_${Date.now()}`,
      created: staleTs,
    });
    const staleSig = crypto
      .createHmac("sha256", stripeWebhookSecret)
      .update(`${staleTs}.${staleBody}`)
      .digest("hex");
    await expect(
      processPaymentWebhook({
        provider: PaymentProvider.STRIPE,
        rawBody: staleBody,
        signature: `t=${staleTs},v1=${staleSig}`,
      })
    ).rejects.toThrow(WebhookVerificationError);

    // Valid webhook succeeds and transitions PaymentIntent -> CAPTURED + Ledger + Order
    const res = await processPaymentWebhook({
      provider: PaymentProvider.STRIPE,
      rawBody: stripeBody,
      signature: stripeHeader,
    });
    expect(res.status).toBe("PROCESSED");

    const updatedIntent = await getPaymentIntentById(tenantAId, intent.id);
    expect(updatedIntent.status).toBe(PaymentIntentStatus.CAPTURED);
    expect(updatedIntent.capturedMinorUnits).toBe(7500);

    // Duplicate eventId ignored safely
    const dupRes = await processPaymentWebhook({
      provider: PaymentProvider.STRIPE,
      rawBody: stripeBody,
      signature: stripeHeader,
    });
    expect(dupRes.status).toBe("DUPLICATE");

    // Reconciliation engine classifies MATCHED, AMOUNT_MISMATCH, MISSING_INTERNAL, DUPLICATE
    const recRun = await reconcilePayments(tenantAId, {
      provider: "STRIPE",
      providerRecords: [
        {
          provider: "STRIPE",
          providerEntityId: updatedIntent.providerOrderId!,
          providerOrderId: updatedIntent.providerOrderId!,
          amountMinorUnits: 7400, // intentional $1 mismatch
          currency: "USD",
          status: "succeeded",
        },
        {
          provider: "STRIPE",
          providerEntityId: "ch_orphan_missing_internal",
          amountMinorUnits: 5000,
          currency: "USD",
          status: "succeeded",
        },
        {
          provider: "STRIPE",
          providerEntityId: "ch_orphan_missing_internal", // duplicate provider record
          amountMinorUnits: 5000,
          currency: "USD",
          status: "succeeded",
        },
      ],
    });

    expect(recRun.type).toBe(ReconciliationType.PAYMENT);
    expect(recRun.mismatchCount).toBeGreaterThanOrEqual(3);
    expect(recRun.entries.some((e) => e.status === ReconciliationStatus.AMOUNT_MISMATCH)).toBe(true);
    expect(recRun.entries.some((e) => e.status === ReconciliationStatus.MISSING_INTERNAL)).toBe(true);
    expect(recRun.entries.some((e) => e.status === ReconciliationStatus.DUPLICATE)).toBe(true);

    // Resolving discrepancy decrements unresolvedCount
    const mismatchEntry = recRun.entries.find(
      (e) => e.status === ReconciliationStatus.AMOUNT_MISMATCH
    )!;
    await resolveReconciliationEntry(
      tenantAId,
      mismatchEntry.id,
      "Confirmed $1 gateway fee deduction",
      userAId
    );
    const updatedRun = await getReconciliationRunById(tenantAId, recRun.id);
    expect(updatedRun.unresolvedCount).toBe(recRun.unresolvedCount - 1);

    // Refund and Shipment reconciliation runs succeed
    const refRec = await reconcileRefunds(tenantAId);
    expect(refRec.type).toBe(ReconciliationType.REFUND);
    expect(refRec.mismatchCount).toBe(0);

    const shipRec = await reconcileShipments(tenantAId);
    expect(shipRec.type).toBe(ReconciliationType.SHIPMENT);
    expect(shipRec.matchedCount).toBeGreaterThanOrEqual(1);
  });

  it("verifies Razorpay HMAC-SHA256 webhook signature and handles captured payment events", async () => {
    const rzpSecret = `rzp_whsec_${Date.now()}`;
    await upsertPaymentProviderConfig(tenantAId, {
      provider: PaymentProvider.RAZORPAY,
      environment: "sandbox",
      accountIdentifier: `rzp_acct_${tenantAId.slice(0, 8)}`,
      credentials: { keyId: "rzp_test_key", keySecret: "rzp_test_secret", webhookSecret: rzpSecret },
    });

    const order = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.CONFIRMED,
      items: [{ title: "Razorpay Pour Over", quantity: 1, unitPrice: 80 }],
    });

    const intent = await createPaymentIntent(tenantAId, {
      orderId: order.id,
      provider: PaymentProvider.RAZORPAY,
      amountMinorUnits: 8000,
      currency: "USD",
      idempotencyKey: `rzp-pi-${order.id}`,
    });

    const bodyStr = JSON.stringify({
      id: `evt_rzp_${Date.now()}`,
      event: "payment.captured",
      created_at: Math.floor(Date.now() / 1000),
      payload: {
        payment: {
          entity: {
            id: `pay_rzp_${Date.now()}`,
            order_id: intent.providerOrderId,
            amount: 8000,
            currency: "USD",
            notes: { businessId: tenantAId, orderId: order.id },
          },
        },
      },
    });

    await expect(
      processPaymentWebhook({
        provider: PaymentProvider.RAZORPAY,
        rawBody: bodyStr,
        signature: "invalid_hmac",
      })
    ).rejects.toThrow(WebhookVerificationError);

    const validRzpSig = crypto.createHmac("sha256", rzpSecret).update(bodyStr).digest("hex");
    const okRes = await processPaymentWebhook({
      provider: PaymentProvider.RAZORPAY,
      rawBody: bodyStr,
      signature: validRzpSig,
    });
    expect(okRes.status).toBe("PROCESSED");

    const updated = await getPaymentIntentById(tenantAId, intent.id);
    expect(updated.status).toBe(PaymentIntentStatus.CAPTURED);
    expect(updated.capturedMinorUnits).toBe(8000);
  });
});

describe("Phase 5: Multi-Tenant Isolation & Authorization Boundaries", () => {
  it("prevents Tenant B from reading or mutating Tenant A's intents, refunds, returns, configs, or recon runs", async () => {
    const orderA = await tenantA.createOrder({
      customerId: customerAId,
      status: OrderStatus.DELIVERED,
      items: [{ title: "Tenant A Secret Product", quantity: 1, unitPrice: 60 }],
    });
    const intentA = await createPaymentIntent(tenantAId, {
      orderId: orderA.id,
      amountMinorUnits: 6000,
      currency: "USD",
      idempotencyKey: `iso-pi-${orderA.id}`,
    });
    await attemptPaymentIntent(tenantAId, intentA.id, {
      idempotencyKey: `iso-att-${orderA.id}`,
      autoCapture: true,
    });
    const refundA = await requestRefund(tenantAId, {
      orderId: orderA.id,
      paymentIntentId: intentA.id,
      amountMinorUnits: 2000,
      reason: "Tenant A refund",
      idempotencyKey: `iso-ref-${orderA.id}`,
      processImmediately: true,
    });
    const returnA = await createReturnRequest(tenantAId, {
      orderId: orderA.id,
      reason: ReturnReason.SIZE_ISSUE,
    });

    await expect(getPaymentIntentById(tenantBId, intentA.id)).rejects.toThrow(NotFoundError);
    await expect(
      capturePaymentIntent(tenantBId, intentA.id, { idempotencyKey: "hijack-cap" })
    ).rejects.toThrow(NotFoundError);
    await expect(
      cancelPaymentIntent(tenantBId, intentA.id, "Hijack")
    ).rejects.toThrow(NotFoundError);
    await expect(
      requestRefund(tenantBId, {
        orderId: orderA.id,
        amountMinorUnits: 1000,
        reason: "Cross-tenant theft",
        idempotencyKey: "hijack-ref",
      })
    ).rejects.toThrow(NotFoundError);
    await expect(getRefundById(tenantBId, refundA.id)).rejects.toThrow(NotFoundError);
    await expect(getReturnById(tenantBId, returnA.id)).rejects.toThrow(NotFoundError);
    await expect(
      updateReturnStatus(tenantBId, returnA.id, { status: ReturnStatus.REJECTED })
    ).rejects.toThrow(NotFoundError);

    const bConfigs = await getPaymentProviderConfigs(tenantBId);
    expect(bConfigs).toHaveLength(0);

    const bLedger = await tenantB.getLedgerEntries();
    expect(bLedger.items.some((e) => e.orderId === orderA.id)).toBe(false);
  });
});
