import crypto from "crypto";
import { prisma } from "./prisma";
import {
  PaymentIntentStatus,
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  LedgerEntryType,
  TimelineActor,
  TimelineVisibility,
  EvidenceType,
  EvidenceVerificationState,
  TransactionStatus,
  Prisma,
} from "@prisma/client";
import {
  assertValidMinorUnits,
  normalizeCurrency,
  toMinorUnits,
  minorUnitsToDecimal,
  minorUnitsToMajorString,
} from "./money";
import {
  assertValidTransition,
  PAYMENT_INTENT_TRANSITIONS,
} from "./state-machines";
import {
  getPaymentProvider,
  getDecryptedPaymentProviderCredentials,
} from "./payment-provider";
import { appendBalancedLedgerPair } from "./ledger";
import {
  IdempotencyConflictError,
  NotFoundError,
  PaymentError,
  ValidationError,
} from "./errors";
import { logger } from "./logger";

export interface CreatePaymentIntentInput {
  orderId: string;
  provider?: PaymentProvider;
  amountMinorUnits?: number;
  currency?: string;
  idempotencyKey: string;
  description?: string;
  expiresInMinutes?: number;
  metadata?: Record<string, unknown>;
}

export interface AttemptPaymentInput {
  method?: PaymentMethod;
  amountMinorUnits?: number;
  idempotencyKey: string;
  providerPaymentId?: string;
  referenceNumber?: string;
  simulateFailure?: boolean;
  failureCode?: string;
  failureReason?: string;
  autoCapture?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CapturePaymentIntentInput {
  amountMinorUnits?: number;
  providerPaymentId?: string;
  idempotencyKey: string;
}

/**
 * Computes authoritative Order payment status & amountPaid Decimal from verified payments / ledger.
 */
async function syncOrderPaymentSummary(
  tx: Prisma.TransactionClient,
  businessId: string,
  orderId: string
) {
  const order = await tx.order.findFirst({
    where: { id: orderId, businessId },
    select: {
      id: true,
      totalAmount: true,
      currency: true,
      refundedAmountMinorUnits: true,
      customerId: true,
      socialTransaction: { select: { id: true, status: true } },
    },
  });
  if (!order) return null;

  const totalMinor = toMinorUnits(order.totalAmount, order.currency);

  // Sum all captured ledger entries vs refunded entries for authoritative net paid
  const capturedAgg = await tx.ledgerEntry.aggregate({
    where: {
      businessId,
      orderId,
      account: "ORDER_RECEIVABLE",
      entryType: {
        in: [LedgerEntryType.PAYMENT_CAPTURED, LedgerEntryType.PAYMENT_RECEIVED],
      },
      direction: "CREDIT",
    },
    _sum: { amountMinorUnits: true },
  });

  const capturedMinor = capturedAgg._sum.amountMinorUnits || 0;
  const refundedMinor = order.refundedAmountMinorUnits || 0;

  let newPaymentStatus: PaymentStatus = PaymentStatus.PENDING;
  if (capturedMinor > 0 && refundedMinor >= capturedMinor) {
    newPaymentStatus = PaymentStatus.REFUNDED;
  } else if (capturedMinor >= totalMinor && totalMinor > 0) {
    newPaymentStatus = PaymentStatus.PAID;
  } else if (capturedMinor > 0) {
    newPaymentStatus = PaymentStatus.PARTIALLY_PAID;
  }

  const updatedOrder = await tx.order.update({
    where: { id: order.id },
    data: {
      amountPaid: minorUnitsToDecimal(capturedMinor, order.currency),
      paymentStatus: newPaymentStatus,
    },
  });

  if (order.socialTransaction && newPaymentStatus === PaymentStatus.PAID) {
    if (
      order.socialTransaction.status === TransactionStatus.INQUIRY ||
      order.socialTransaction.status === TransactionStatus.INTENT_CONFIRMED ||
      order.socialTransaction.status === TransactionStatus.ORDER_CREATED ||
      order.socialTransaction.status === TransactionStatus.PAYMENT_PENDING
    ) {
      await tx.socialTransaction.update({
        where: { id: order.socialTransaction.id },
        data: { status: TransactionStatus.PAYMENT_VERIFIED },
      });
    }
  }

  return updatedOrder;
}

/**
 * Creates a tenant-scoped, idempotent PaymentIntent backed by server-derived order amounts.
 */
export async function createPaymentIntent(
  businessId: string,
  input: CreatePaymentIntentInput,
  actorUserId?: string
) {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 4) {
    throw new ValidationError("idempotencyKey (min 4 chars) is required for payment intents");
  }

  const idempotencyKey = input.idempotencyKey.trim();
  const provider = input.provider || PaymentProvider.MANUAL;

  // Fetch order strictly scoped to tenant
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, businessId },
    include: {
      customer: { select: { email: true, phone: true } },
      socialTransaction: { select: { id: true } },
    },
  });

  if (!order) {
    throw new NotFoundError("Order not found in business tenant");
  }

  const currency = normalizeCurrency(input.currency || order.currency);
  if (currency !== order.currency) {
    throw new PaymentError(
      `Currency mismatch: payment intent currency ${currency} does not match order currency ${order.currency}`
    );
  }

  const orderTotalMinor = toMinorUnits(order.totalAmount, currency);
  const alreadyPaidMinor = toMinorUnits(order.amountPaid, currency);
  const remainingMinor = Math.max(0, orderTotalMinor - alreadyPaidMinor);

  const amountMinorUnits =
    input.amountMinorUnits !== undefined ? input.amountMinorUnits : remainingMinor;

  assertValidMinorUnits(amountMinorUnits, "amountMinorUnits");
  if (amountMinorUnits <= 0) {
    throw new PaymentError("PaymentIntent amount must be greater than zero");
  }
  if (amountMinorUnits > remainingMinor && orderTotalMinor > 0) {
    throw new PaymentError(
      `Requested payment (${minorUnitsToMajorString(amountMinorUnits, currency)} ${currency}) exceeds remaining order balance (${minorUnitsToMajorString(remainingMinor, currency)} ${currency})`
    );
  }

  // Idempotency check
  const existing = await prisma.paymentIntent.findUnique({
    where: {
      businessId_idempotencyKey: {
        businessId,
        idempotencyKey,
      },
    },
    include: { attempts: true },
  });

  if (existing) {
    if (
      existing.orderId !== order.id ||
      existing.amountMinorUnits !== amountMinorUnits ||
      existing.currency !== currency ||
      existing.provider !== provider
    ) {
      throw new IdempotencyConflictError(
        "Idempotency key already used for a payment intent with different order, amount, currency, or provider"
      );
    }
    return existing;
  }

  const adapter = getPaymentProvider(provider);
  const credentials = await getDecryptedPaymentProviderCredentials(businessId, provider);

  const providerResult = await adapter.createPayment(
    {
      orderId: order.id,
      orderNumber: order.orderNumber,
      amountMinorUnits,
      currency,
      idempotencyKey,
      description: input.description,
      customerEmail: order.customer?.email,
      customerPhone: order.customer?.phone,
      metadata: {
        ...(input.metadata || {}),
        businessId,
        orderId: order.id,
      },
    },
    credentials
  );

  const expiresAt = input.expiresInMinutes
    ? new Date(Date.now() + input.expiresInMinutes * 60 * 1000)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const intent = await tx.paymentIntent.create({
      data: {
        businessId,
        orderId: order.id,
        socialTransactionId: order.socialTransaction?.id ?? null,
        provider,
        providerOrderId: providerResult.providerOrderId,
        status: PaymentIntentStatus.CREATED,
        amountMinorUnits,
        currency,
        idempotencyKey,
        description: input.description || `Payment for order ${order.orderNumber}`,
        metadata: {
          ...(input.metadata || {}),
          checkoutData: providerResult.checkoutData || {},
        } as Prisma.InputJsonValue,
        expiresAt,
      },
      include: { attempts: true },
    });

    await tx.auditLog.create({
      data: {
        businessId,
        userId: actorUserId || null,
        action: "PAYMENT_INTENT_CREATED",
        entityType: "PAYMENT_INTENT",
        entityId: intent.id,
        metadata: {
          orderId: order.id,
          provider,
          providerOrderId: providerResult.providerOrderId,
          amountMinorUnits,
          currency,
        },
      },
    });

    logger.info("payment_intent.created", {
      paymentIntentId: intent.id,
      businessId,
      orderId: order.id,
      provider,
      amountMinorUnits,
      currency,
    });

    return intent;
  });
}

/**
 * Executes a payment attempt against a PaymentIntent. Creates an immutable PaymentAttempt
 * row on every try so retry history is never lost.
 */
export async function attemptPaymentIntent(
  businessId: string,
  paymentIntentId: string,
  input: AttemptPaymentInput,
  actorUserId?: string
) {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 4) {
    throw new ValidationError("Attempt idempotencyKey is required");
  }
  const idempotencyKey = input.idempotencyKey.trim();

  const intent = await prisma.paymentIntent.findFirst({
    where: { id: paymentIntentId, businessId },
    include: {
      attempts: { orderBy: { attemptNumber: "desc" } },
      order: { include: { socialTransaction: true } },
    },
  });

  if (!intent) {
    throw new NotFoundError("PaymentIntent not found in business tenant");
  }

  // Idempotent attempt deduplication
  const existingAttempt = await prisma.paymentAttempt.findUnique({
    where: {
      paymentIntentId_idempotencyKey: {
        paymentIntentId,
        idempotencyKey,
      },
    },
  });
  if (existingAttempt) {
    return { attempt: existingAttempt, intent, deduplicated: true };
  }

  const attemptAmount =
    input.amountMinorUnits !== undefined ? input.amountMinorUnits : intent.amountMinorUnits;
  assertValidMinorUnits(attemptAmount, "amountMinorUnits");
  if (attemptAmount <= 0 || attemptAmount > intent.amountMinorUnits) {
    throw new PaymentError("Attempt amount must be positive and within PaymentIntent amount");
  }

  const adapter = getPaymentProvider(intent.provider);
  const credentials = await getDecryptedPaymentProviderCredentials(businessId, intent.provider);
  const nextAttemptNumber = (intent.attempts[0]?.attemptNumber || 0) + 1;

  if (input.simulateFailure) {
    assertValidTransition(
      "PaymentIntent",
      PAYMENT_INTENT_TRANSITIONS,
      intent.status,
      PaymentIntentStatus.FAILED
    );

    const providerPaymentId =
      input.providerPaymentId ||
      `fail_${crypto.createHash("sha256").update(`${paymentIntentId}:${idempotencyKey}`).digest("hex").slice(0, 14)}`;

    return prisma.$transaction(async (tx) => {
      const attempt = await tx.paymentAttempt.create({
        data: {
          paymentIntentId: intent.id,
          businessId,
          attemptNumber: nextAttemptNumber,
          provider: intent.provider,
          providerPaymentId,
          providerOrderId: intent.providerOrderId,
          amountMinorUnits: attemptAmount,
          currency: intent.currency,
          status: PaymentAttemptStatus.FAILED,
          method: input.method || PaymentMethod.CARD,
          failureCode: input.failureCode || "PAYMENT_DECLINED",
          failureReason: input.failureReason || "Provider declined payment attempt",
          idempotencyKey,
          metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });

      const updatedIntent = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      });

      await tx.auditLog.create({
        data: {
          businessId,
          userId: actorUserId || null,
          action: "PAYMENT_ATTEMPT_FAILED",
          entityType: "PAYMENT_ATTEMPT",
          entityId: attempt.id,
          metadata: {
            paymentIntentId: intent.id,
            attemptNumber: nextAttemptNumber,
            failureCode: attempt.failureCode,
            failureReason: attempt.failureReason,
          },
        },
      });

      return { attempt, intent: updatedIntent, deduplicated: false };
    });
  }

  const authRes = await adapter.authorizePayment(
    {
      providerOrderId: intent.providerOrderId,
      providerPaymentId: input.providerPaymentId,
      amountMinorUnits: attemptAmount,
      currency: intent.currency,
      method: input.method,
      idempotencyKey,
      metadata: input.metadata,
    },
    credentials
  );

  const shouldAutoCapture = input.autoCapture === true;
  let captureRes:
    | {
        providerPaymentId: string;
        status: "CAPTURED" | "FAILED";
        capturedMinorUnits: number;
      }
    | undefined;

  if (shouldAutoCapture) {
    captureRes = await adapter.capturePayment(
      {
        providerOrderId: intent.providerOrderId,
        providerPaymentId: authRes.providerPaymentId,
        amountMinorUnits: attemptAmount,
        currency: intent.currency,
        idempotencyKey: `${idempotencyKey}:capture`,
      },
      credentials
    );
  }

  const targetIntentStatus = shouldAutoCapture
    ? attemptAmount >= intent.amountMinorUnits
      ? PaymentIntentStatus.CAPTURED
      : PaymentIntentStatus.PARTIALLY_CAPTURED
    : PaymentIntentStatus.AUTHORIZED;

  assertValidTransition(
    "PaymentIntent",
    PAYMENT_INTENT_TRANSITIONS,
    intent.status,
    targetIntentStatus
  );

  return prisma.$transaction(async (tx) => {
    const attemptStatus = shouldAutoCapture
      ? PaymentAttemptStatus.CAPTURED
      : PaymentAttemptStatus.AUTHORIZED;

    const attempt = await tx.paymentAttempt.create({
      data: {
        paymentIntentId: intent.id,
        businessId,
        attemptNumber: nextAttemptNumber,
        provider: intent.provider,
        providerPaymentId: authRes.providerPaymentId,
        providerOrderId: intent.providerOrderId,
        amountMinorUnits: attemptAmount,
        currency: intent.currency,
        status: attemptStatus,
        method: input.method || PaymentMethod.CARD,
        idempotencyKey,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const newCapturedMinor = shouldAutoCapture
      ? intent.capturedMinorUnits + attemptAmount
      : intent.capturedMinorUnits;

    const updatedIntent = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: targetIntentStatus,
        capturedMinorUnits: newCapturedMinor,
      },
    });

    if (shouldAutoCapture) {
      const payment = await tx.payment.create({
        data: {
          businessId,
          orderId: intent.orderId,
          customerId: intent.order.customerId,
          paymentIntentId: intent.id,
          amount: minorUnitsToDecimal(attemptAmount, intent.currency),
          amountMinorUnits: attemptAmount,
          currency: intent.currency,
          method: input.method || PaymentMethod.CARD,
          provider: intent.provider,
          providerPaymentId: authRes.providerPaymentId,
          idempotencyKey,
          status: PaymentRecordStatus.VERIFIED,
          referenceNumber: input.referenceNumber || authRes.providerPaymentId,
          verifiedBy: actorUserId || intent.provider,
          verifiedAt: new Date(),
        },
      });

      await appendBalancedLedgerPair(
        {
          businessId,
          orderId: intent.orderId,
          socialTransactionId: intent.socialTransactionId,
          paymentId: payment.id,
          paymentIntentId: intent.id,
          entryType: LedgerEntryType.PAYMENT_CAPTURED,
          debitAccount: "PROVIDER_CLEARING",
          creditAccount: "ORDER_RECEIVABLE",
          amountMinorUnits: attemptAmount,
          currency: intent.currency,
          referenceType: "PAYMENT_INTENT",
          referenceId: intent.id,
          provider: intent.provider,
          idempotencyKeyPrefix: `capture:${intent.id}:${idempotencyKey}`,
          description: `Captured ${minorUnitsToMajorString(attemptAmount, intent.currency)} ${intent.currency} via ${intent.provider}`,
        },
        tx
      );

      await syncOrderPaymentSummary(tx, businessId, intent.orderId);

      if (intent.order.socialTransaction) {
        await tx.transactionTimelineEvent.create({
          data: {
            transactionId: intent.order.socialTransaction.id,
            eventType: "PAYMENT_CAPTURED",
            title: `Payment Captured: ${intent.currency} ${minorUnitsToMajorString(attemptAmount, intent.currency)}`,
            description: `Captured via ${intent.provider} (Ref: ${authRes.providerPaymentId})`,
            actor: TimelineActor.SYSTEM,
            visibility: TimelineVisibility.PUBLIC,
          },
        });
        await tx.transactionEvidence.create({
          data: {
            transactionId: intent.order.socialTransaction.id,
            evidenceType: EvidenceType.PAYMENT_VERIFICATION,
            verificationState: EvidenceVerificationState.SYSTEM_GENERATED,
            source: `PAYMENT_PROVIDER:${intent.provider}`,
            actor: TimelineActor.SYSTEM,
            notes: `Provider payment ${authRes.providerPaymentId} captured cleanly.`,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        businessId,
        userId: actorUserId || null,
        action: shouldAutoCapture ? "PAYMENT_INTENT_CAPTURED" : "PAYMENT_INTENT_AUTHORIZED",
        entityType: "PAYMENT_INTENT",
        entityId: intent.id,
        metadata: {
          attemptId: attempt.id,
          providerPaymentId: authRes.providerPaymentId,
          amountMinorUnits: attemptAmount,
          currency: intent.currency,
        },
      },
    });

    return { attempt, intent: updatedIntent, captureRes, deduplicated: false };
  });
}

/**
 * Captures an AUTHORIZED (or PARTIALLY_CAPTURED) PaymentIntent, supporting partial or full capture,
 * recording immutable ledger entries and syncing order totals.
 */
export async function capturePaymentIntent(
  businessId: string,
  paymentIntentId: string,
  input: CapturePaymentIntentInput,
  actorUserId?: string
) {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 4) {
    throw new ValidationError("Capture idempotencyKey is required");
  }
  const idempotencyKey = input.idempotencyKey.trim();

  const intent = await prisma.paymentIntent.findFirst({
    where: { id: paymentIntentId, businessId },
    include: {
      attempts: { orderBy: { attemptNumber: "desc" } },
      order: { include: { socialTransaction: true } },
    },
  });

  if (!intent) {
    throw new NotFoundError("PaymentIntent not found in business tenant");
  }

  // Deduplicate capture by idempotencyKey on Payment
  const existingPayment = await prisma.payment.findFirst({
    where: {
      businessId,
      paymentIntentId: intent.id,
      idempotencyKey,
    },
  });
  if (existingPayment) {
    return { intent, payment: existingPayment, deduplicated: true };
  }

  const remainingCapturable = Math.max(0, intent.amountMinorUnits - intent.capturedMinorUnits);
  const captureAmount =
    input.amountMinorUnits !== undefined ? input.amountMinorUnits : remainingCapturable;

  assertValidMinorUnits(captureAmount, "amountMinorUnits");
  if (captureAmount <= 0) {
    throw new PaymentError("Capture amount must be greater than zero");
  }
  if (captureAmount > remainingCapturable) {
    throw new PaymentError(
      `Capture amount (${captureAmount}) exceeds remaining capturable amount (${remainingCapturable})`
    );
  }

  const newCapturedMinor = intent.capturedMinorUnits + captureAmount;
  const targetStatus =
    newCapturedMinor >= intent.amountMinorUnits
      ? PaymentIntentStatus.CAPTURED
      : PaymentIntentStatus.PARTIALLY_CAPTURED;

  assertValidTransition("PaymentIntent", PAYMENT_INTENT_TRANSITIONS, intent.status, targetStatus);

  const adapter = getPaymentProvider(intent.provider);
  const credentials = await getDecryptedPaymentProviderCredentials(businessId, intent.provider);
  const providerPaymentId =
    input.providerPaymentId || intent.attempts.find((a) => a.providerPaymentId)?.providerPaymentId;

  const captureResult = await adapter.capturePayment(
    {
      providerOrderId: intent.providerOrderId,
      providerPaymentId,
      amountMinorUnits: captureAmount,
      currency: intent.currency,
      idempotencyKey,
    },
    credentials
  );

  return prisma.$transaction(async (tx) => {
    // Acquire row-level lock on Order to serialize concurrent capture mutations
    await tx.$executeRaw`SELECT id FROM "orders" WHERE "id" = ${intent.orderId} FOR UPDATE`;

    const latestIntent = await tx.paymentIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    const latestRemaining = Math.max(0, latestIntent.amountMinorUnits - latestIntent.capturedMinorUnits);
    if (captureAmount > latestRemaining) {
      throw new PaymentError(
        `Concurrent capture rejected: capture amount (${captureAmount}) exceeds remaining capturable amount (${latestRemaining})`
      );
    }
    const latestCapturedTotal = latestIntent.capturedMinorUnits + captureAmount;
    const latestStatus =
      latestCapturedTotal >= latestIntent.amountMinorUnits
        ? PaymentIntentStatus.CAPTURED
        : PaymentIntentStatus.PARTIALLY_CAPTURED;

    const attemptNumber = (intent.attempts[0]?.attemptNumber || 0) + 1;
    await tx.paymentAttempt.create({
      data: {
        paymentIntentId: intent.id,
        businessId,
        attemptNumber,
        provider: intent.provider,
        providerPaymentId: `${captureResult.providerPaymentId}:cap_${attemptNumber}`,
        providerOrderId: intent.providerOrderId,
        amountMinorUnits: captureAmount,
        currency: intent.currency,
        status: PaymentAttemptStatus.CAPTURED,
        idempotencyKey: `cap:${idempotencyKey}`,
      },
    });

    const updatedIntent = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: latestStatus,
        capturedMinorUnits: latestCapturedTotal,
      },
    });

    const payment = await tx.payment.create({
      data: {
        businessId,
        orderId: intent.orderId,
        customerId: intent.order.customerId,
        paymentIntentId: intent.id,
        amount: minorUnitsToDecimal(captureAmount, intent.currency),
        amountMinorUnits: captureAmount,
        currency: intent.currency,
        method:
          intent.provider === PaymentProvider.RAZORPAY
            ? PaymentMethod.RAZORPAY
            : intent.provider === PaymentProvider.STRIPE
            ? PaymentMethod.STRIPE
            : PaymentMethod.OTHER,
        provider: intent.provider,
        providerPaymentId: captureResult.providerPaymentId,
        idempotencyKey,
        status: PaymentRecordStatus.VERIFIED,
        referenceNumber: captureResult.providerPaymentId,
        verifiedBy: actorUserId || intent.provider,
        verifiedAt: new Date(),
      },
    });

    await appendBalancedLedgerPair(
      {
        businessId,
        orderId: intent.orderId,
        socialTransactionId: intent.socialTransactionId,
        paymentId: payment.id,
        paymentIntentId: intent.id,
        entryType: LedgerEntryType.PAYMENT_CAPTURED,
        debitAccount: "PROVIDER_CLEARING",
        creditAccount: "ORDER_RECEIVABLE",
        amountMinorUnits: captureAmount,
        currency: intent.currency,
        referenceType: "PAYMENT",
        referenceId: payment.id,
        provider: intent.provider,
        idempotencyKeyPrefix: `capture:${intent.id}:${idempotencyKey}`,
        description: `Payment captured: ${minorUnitsToMajorString(captureAmount, intent.currency)} ${intent.currency}`,
      },
      tx
    );

    await syncOrderPaymentSummary(tx, businessId, intent.orderId);

    if (intent.order.socialTransaction) {
      await tx.transactionTimelineEvent.create({
        data: {
          transactionId: intent.order.socialTransaction.id,
          eventType: "PAYMENT_CAPTURED",
          title: `Payment Captured: ${intent.currency} ${minorUnitsToMajorString(captureAmount, intent.currency)}`,
          description: `Verified via ${intent.provider} (${captureResult.providerPaymentId})`,
          actor: TimelineActor.SYSTEM,
          visibility: TimelineVisibility.PUBLIC,
        },
      });
      await tx.transactionEvidence.create({
        data: {
          transactionId: intent.order.socialTransaction.id,
          evidenceType: EvidenceType.PAYMENT_VERIFICATION,
          verificationState: EvidenceVerificationState.SYSTEM_GENERATED,
          source: `PAYMENT_PROVIDER:${intent.provider}`,
          actor: TimelineActor.SYSTEM,
          notes: `Captured payment ${payment.id} (${captureResult.providerPaymentId})`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        businessId,
        userId: actorUserId || null,
        action: "PAYMENT_INTENT_CAPTURED",
        entityType: "PAYMENT_INTENT",
        entityId: intent.id,
        metadata: {
          paymentId: payment.id,
          captureAmount,
          newCapturedMinor: updatedIntent.capturedMinorUnits,
          status: updatedIntent.status,
        },
      },
    });

    return { intent: updatedIntent, payment, deduplicated: false };
  });
}

/**
 * Cancels an uncaptured PaymentIntent via state machine verification.
 */
export async function cancelPaymentIntent(
  businessId: string,
  paymentIntentId: string,
  reason?: string,
  actorUserId?: string
) {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id: paymentIntentId, businessId },
  });
  if (!intent) {
    throw new NotFoundError("PaymentIntent not found in business tenant");
  }

  assertValidTransition(
    "PaymentIntent",
    PAYMENT_INTENT_TRANSITIONS,
    intent.status,
    PaymentIntentStatus.CANCELLED
  );

  const adapter = getPaymentProvider(intent.provider);
  const credentials = await getDecryptedPaymentProviderCredentials(businessId, intent.provider);
  await adapter.cancelPayment({ providerOrderId: intent.providerOrderId, reason }, credentials);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { status: PaymentIntentStatus.CANCELLED },
    });

    await tx.auditLog.create({
      data: {
        businessId,
        userId: actorUserId || null,
        action: "PAYMENT_INTENT_CANCELLED",
        entityType: "PAYMENT_INTENT",
        entityId: intent.id,
        metadata: { reason: reason || "Cancelled by merchant" },
      },
    });

    return updated;
  });
}

export async function getPaymentIntents(
  businessId: string,
  filter?: {
    orderId?: string;
    status?: PaymentIntentStatus;
    provider?: PaymentProvider;
    page?: number;
    limit?: number;
  }
) {
  const page = Math.max(1, filter?.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.PaymentIntentWhereInput = {
    businessId,
    ...(filter?.orderId ? { orderId: filter.orderId } : {}),
    ...(filter?.status ? { status: filter.status } : {}),
    ...(filter?.provider ? { provider: filter.provider } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.paymentIntent.count({ where }),
    prisma.paymentIntent.findMany({
      where,
      include: {
        order: { select: { id: true, orderNumber: true, totalAmount: true, currency: true } },
        attempts: { orderBy: { attemptNumber: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  return {
    items,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getPaymentIntentById(businessId: string, id: string) {
  const intent = await prisma.paymentIntent.findFirst({
    where: { id, businessId },
    include: {
      order: { select: { id: true, orderNumber: true, totalAmount: true, amountPaid: true, currency: true } },
      attempts: { orderBy: { attemptNumber: "asc" } },
      refunds: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!intent) {
    throw new NotFoundError("PaymentIntent not found in business tenant");
  }
  return intent;
}
