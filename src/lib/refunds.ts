import { prisma } from "./prisma";
import {
  RefundStatus,
  RefundType,
  PaymentProvider,
  PaymentStatus,
  PaymentRecordStatus,
  PaymentIntentStatus,
  ReturnStatus,
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
  minorUnitsToMajorString,
} from "./money";
import { assertValidTransition, REFUND_TRANSITIONS } from "./state-machines";
import {
  getPaymentProvider,
  getDecryptedPaymentProviderCredentials,
} from "./payment-provider";
import { appendBalancedLedgerPair } from "./ledger";
import {
  IdempotencyConflictError,
  NotFoundError,
  RefundError,
  ValidationError,
} from "./errors";
import { logger } from "./logger";

export interface RequestRefundInput {
  orderId: string;
  paymentId?: string | null;
  paymentIntentId?: string | null;
  returnRequestId?: string | null;
  disputeId?: string | null;
  type?: RefundType;
  amountMinorUnits: number;
  currency?: string;
  reason: string;
  provider?: PaymentProvider;
  idempotencyKey: string;
  processImmediately?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Computes how much captured payment is available to refund on an order in minor units.
 */
async function getOrderRefundableAmounts(
  tx: Prisma.TransactionClient,
  businessId: string,
  orderId: string,
  currency: string
) {
  const order = await tx.order.findFirst({
    where: { id: orderId, businessId },
    include: {
      payments: { where: { status: PaymentRecordStatus.VERIFIED } },
      refunds: {
        where: {
          status: { in: [RefundStatus.REQUESTED, RefundStatus.PROCESSING, RefundStatus.COMPLETED] },
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundError("Order not found in business tenant");
  }

  // Authoritative captured amount: max of verified payments sum and order.amountPaid
  const paidMinorFromOrder = toMinorUnits(order.amountPaid, currency);
  const paidMinorFromPayments = order.payments.reduce((sum, p) => {
    const val =
      p.amountMinorUnits !== null && p.amountMinorUnits !== undefined
        ? p.amountMinorUnits
        : toMinorUnits(p.amount, p.currency);
    return sum + val;
  }, 0);

  const totalCapturedMinor = Math.max(paidMinorFromOrder, paidMinorFromPayments);

  const activeOrCompletedRefundsMinor = order.refunds.reduce(
    (sum, r) => sum + r.amountMinorUnits,
    0
  );

  const remainingRefundableMinor = Math.max(
    0,
    totalCapturedMinor - activeOrCompletedRefundsMinor
  );

  return {
    order,
    totalCapturedMinor,
    activeOrCompletedRefundsMinor,
    remainingRefundableMinor,
  };
}

/**
 * Requests a refund with strict financial invariants, currency validation, and idempotency.
 */
export async function requestRefund(
  businessId: string,
  input: RequestRefundInput,
  actorUserId?: string
) {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < 4) {
    throw new ValidationError("idempotencyKey (min 4 chars) is required for refunds");
  }
  if (!input.reason || input.reason.trim().length < 3) {
    throw new ValidationError("Refund reason must be at least 3 characters");
  }
  assertValidMinorUnits(input.amountMinorUnits, "amountMinorUnits");
  if (input.amountMinorUnits <= 0) {
    throw new RefundError("Refund amount must be greater than zero");
  }

  const idempotencyKey = input.idempotencyKey.trim();

  // Check idempotency first
  const existing = await prisma.refund.findUnique({
    where: {
      businessId_idempotencyKey: {
        businessId,
        idempotencyKey,
      },
    },
  });
  if (existing) {
    if (
      existing.orderId !== input.orderId ||
      existing.amountMinorUnits !== input.amountMinorUnits
    ) {
      throw new IdempotencyConflictError(
        "Idempotency key already used for a refund with different orderId or amount"
      );
    }
    return existing;
  }

  const created = await prisma.$transaction(async (tx) => {
    // Acquire row-level lock on Order to serialize concurrent refund requests for the same order
    await tx.$executeRaw`SELECT id FROM "orders" WHERE "id" = ${input.orderId} FOR UPDATE`;

    // Re-check inside transaction to avoid concurrent race over-refunds
    const existingInTx = await tx.refund.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId,
          idempotencyKey,
        },
      },
    });
    if (existingInTx) return existingInTx;

    const orderMeta = await tx.order.findFirst({
      where: { id: input.orderId, businessId },
      include: { socialTransaction: { select: { id: true } } },
    });
    if (!orderMeta) {
      throw new NotFoundError("Order not found in business tenant");
    }

    const currency = normalizeCurrency(input.currency || orderMeta.currency);
    if (currency !== orderMeta.currency) {
      throw new RefundError(
        `Refund currency ${currency} must match order currency ${orderMeta.currency}`
      );
    }

    const { totalCapturedMinor, remainingRefundableMinor } = await getOrderRefundableAmounts(
      tx,
      businessId,
      input.orderId,
      currency
    );

    if (totalCapturedMinor <= 0) {
      throw new RefundError("Cannot refund an order that has zero captured payment");
    }

    if (input.amountMinorUnits > remainingRefundableMinor) {
      throw new RefundError(
        `Over-refund rejected: requested ${minorUnitsToMajorString(input.amountMinorUnits, currency)} ${currency} exceeds remaining refundable amount ${minorUnitsToMajorString(remainingRefundableMinor, currency)} ${currency}`
      );
    }

    // Validate optional Payment / PaymentIntent belong to same tenant & order
    let resolvedProvider = input.provider || PaymentProvider.MANUAL;
    if (input.paymentIntentId) {
      const pi = await tx.paymentIntent.findFirst({
        where: { id: input.paymentIntentId, businessId, orderId: input.orderId },
      });
      if (!pi) throw new NotFoundError("Linked PaymentIntent not found on order");
      const intentRemaining = pi.capturedMinorUnits - pi.refundedMinorUnits;
      if (input.amountMinorUnits > intentRemaining) {
        throw new RefundError(
          `Refund amount (${input.amountMinorUnits}) exceeds PaymentIntent refundable balance (${intentRemaining})`
        );
      }
      resolvedProvider = input.provider || pi.provider;
    }

    const refundType =
      input.type ||
      (input.amountMinorUnits === totalCapturedMinor && remainingRefundableMinor === totalCapturedMinor
        ? RefundType.FULL_REFUND
        : RefundType.PARTIAL_REFUND);

    const refund = await tx.refund.create({
      data: {
        businessId,
        orderId: input.orderId,
        paymentId: input.paymentId ?? null,
        paymentIntentId: input.paymentIntentId ?? null,
        socialTransactionId: orderMeta.socialTransaction?.id ?? null,
        returnRequestId: input.returnRequestId ?? null,
        disputeId: input.disputeId ?? null,
        type: refundType,
        status: RefundStatus.REQUESTED,
        amountMinorUnits: input.amountMinorUnits,
        currency,
        reason: input.reason.trim(),
        provider: resolvedProvider,
        idempotencyKey,
        requestedByUserId: actorUserId ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        businessId,
        userId: actorUserId || null,
        action: "REFUND_REQUESTED",
        entityType: "REFUND",
        entityId: refund.id,
        metadata: {
          orderId: refund.orderId,
          amountMinorUnits: refund.amountMinorUnits,
          currency: refund.currency,
          type: refund.type,
          reason: refund.reason,
        },
      },
    });

    return refund;
  });

  if (input.processImmediately) {
    return processRefund(businessId, created.id, { actorUserId });
  }

  return created;
}

/**
 * Executes a refund through its configured payment provider adapter, appends immutable
 * double-entry ledger entries, updates order/intent/return states, and records evidence.
 */
export async function processRefund(
  businessId: string,
  refundId: string,
  options?: { actorUserId?: string; simulateFailure?: boolean; failureReason?: string }
) {
  const refund = await prisma.refund.findFirst({
    where: { id: refundId, businessId },
    include: {
      order: { include: { socialTransaction: true } },
      payment: true,
      paymentIntent: { include: { attempts: true } },
    },
  });

  if (!refund) {
    throw new NotFoundError("Refund not found in business tenant");
  }

  if (refund.status === RefundStatus.COMPLETED) {
    return refund; // Idempotent replay guard
  }

  assertValidTransition("Refund", REFUND_TRANSITIONS, refund.status, RefundStatus.PROCESSING);

  // Move to PROCESSING
  await prisma.refund.update({
    where: { id: refund.id },
    data: { status: RefundStatus.PROCESSING },
  });

  if (options?.simulateFailure) {
    return prisma.$transaction(async (tx) => {
      const failed = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.FAILED,
          failureReason: options.failureReason || "Provider refund execution failed",
        },
      });
      await tx.auditLog.create({
        data: {
          businessId,
          userId: options.actorUserId || null,
          action: "REFUND_FAILED",
          entityType: "REFUND",
          entityId: refund.id,
          metadata: { failureReason: failed.failureReason },
        },
      });
      return failed;
    });
  }

  const adapter = getPaymentProvider(refund.provider);
  const credentials = await getDecryptedPaymentProviderCredentials(businessId, refund.provider);

  const providerPaymentId =
    refund.payment?.providerPaymentId ||
    refund.paymentIntent?.attempts.find((a) => a.providerPaymentId)?.providerPaymentId ||
    null;

  const providerRes = await adapter.refundPayment(
    {
      providerPaymentId,
      providerOrderId: refund.paymentIntent?.providerOrderId,
      amountMinorUnits: refund.amountMinorUnits,
      currency: refund.currency,
      reason: refund.reason,
      idempotencyKey: refund.idempotencyKey,
    },
    credentials
  );

  if (providerRes.status === "FAILED") {
    return prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: RefundStatus.FAILED,
        failureReason: providerRes.failureReason || "Provider rejected refund",
      },
    });
  }

  const finalStatus =
    providerRes.status === "COMPLETED" ? RefundStatus.COMPLETED : RefundStatus.PROCESSING;

  return prisma.$transaction(async (tx) => {
    const completed = await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: finalStatus,
        providerRefundId: providerRes.providerRefundId,
        processedAt: finalStatus === RefundStatus.COMPLETED ? new Date() : null,
      },
    });

    if (finalStatus === RefundStatus.COMPLETED) {
      // 1. Append balanced double-entry ledger entries (DEBIT ORDER_RECEIVABLE, CREDIT PROVIDER_CLEARING)
      await appendBalancedLedgerPair(
        {
          businessId,
          orderId: refund.orderId,
          socialTransactionId: refund.socialTransactionId,
          paymentId: refund.paymentId,
          paymentIntentId: refund.paymentIntentId,
          refundId: refund.id,
          entryType: LedgerEntryType.REFUND_COMPLETED,
          debitAccount: "ORDER_RECEIVABLE",
          creditAccount: "PROVIDER_CLEARING",
          amountMinorUnits: refund.amountMinorUnits,
          currency: refund.currency,
          referenceType: "REFUND",
          referenceId: refund.id,
          provider: refund.provider,
          idempotencyKeyPrefix: `refund:${refund.id}`,
          description: `Refund completed (${minorUnitsToMajorString(refund.amountMinorUnits, refund.currency)} ${refund.currency}): ${refund.reason}`,
        },
        tx
      );

      // 2. Recompute cumulative refunded minor units on Order
      const completedRefunds = await tx.refund.aggregate({
        where: {
          businessId,
          orderId: refund.orderId,
          status: RefundStatus.COMPLETED,
        },
        _sum: { amountMinorUnits: true },
      });
      const totalRefundedMinor = completedRefunds._sum.amountMinorUnits || 0;
      const totalCapturedMinor = toMinorUnits(refund.order.amountPaid, refund.currency);

      const orderUpdateData: Prisma.OrderUpdateInput = {
        refundedAmountMinorUnits: totalRefundedMinor,
      };
      if (totalCapturedMinor > 0 && totalRefundedMinor >= totalCapturedMinor) {
        orderUpdateData.paymentStatus = PaymentStatus.REFUNDED;
      }

      await tx.order.update({
        where: { id: refund.orderId },
        data: orderUpdateData,
      });

      // 3. Update PaymentIntent if linked
      if (refund.paymentIntentId && refund.paymentIntent) {
        const piRefunds = await tx.refund.aggregate({
          where: {
            paymentIntentId: refund.paymentIntentId,
            status: RefundStatus.COMPLETED,
          },
          _sum: { amountMinorUnits: true },
        });
        const newPiRefunded = piRefunds._sum.amountMinorUnits || 0;
        const newPiStatus =
          newPiRefunded >= refund.paymentIntent.capturedMinorUnits
            ? PaymentIntentStatus.REFUNDED
            : PaymentIntentStatus.PARTIALLY_REFUNDED;

        await tx.paymentIntent.update({
          where: { id: refund.paymentIntentId },
          data: {
            refundedMinorUnits: newPiRefunded,
            status: newPiStatus,
          },
        });
      }

      // 4. Update Payment record if full refund on single payment
      if (refund.paymentId && refund.payment) {
        const payMinor =
          refund.payment.amountMinorUnits ??
          toMinorUnits(refund.payment.amount, refund.payment.currency);
        if (refund.amountMinorUnits >= payMinor) {
          await tx.payment.update({
            where: { id: refund.paymentId },
            data: { status: PaymentRecordStatus.REFUNDED },
          });
        }
      }

      // 5. Update ReturnRequest if linked
      if (refund.returnRequestId) {
        const ret = await tx.returnRequest.findUnique({
          where: { id: refund.returnRequestId },
        });
        if (
          ret &&
          (ret.status === ReturnStatus.RECEIVED ||
            ret.status === ReturnStatus.INSPECTED ||
            ret.status === ReturnStatus.REFUND_PENDING)
        ) {
          await tx.returnRequest.update({
            where: { id: ret.id },
            data: { status: ReturnStatus.REFUNDED, refundedAt: new Date() },
          });
        }
      }

      // 6. Sync SocialTransaction timeline & evidence
      if (refund.order.socialTransaction) {
        await tx.transactionTimelineEvent.create({
          data: {
            transactionId: refund.order.socialTransaction.id,
            eventType: "REFUND_COMPLETED",
            title: `Refund Issued: ${refund.currency} ${minorUnitsToMajorString(refund.amountMinorUnits, refund.currency)}`,
            description: `${refund.reason} (Provider Ref: ${providerRes.providerRefundId})`,
            actor: TimelineActor.SELLER,
            visibility: TimelineVisibility.PUBLIC,
            metadata: {
              refundId: refund.id,
              providerRefundId: providerRes.providerRefundId,
              amountMinorUnits: refund.amountMinorUnits,
              type: refund.type,
            },
          },
        });
        await tx.transactionEvidence.create({
          data: {
            transactionId: refund.order.socialTransaction.id,
            disputeId: refund.disputeId ?? null,
            evidenceType: EvidenceType.REFUND_PROOF,
            verificationState: EvidenceVerificationState.SYSTEM_GENERATED,
            source: `PAYMENT_PROVIDER:${refund.provider}`,
            actor: TimelineActor.SYSTEM,
            notes: `Completed refund ${refund.id} for ${refund.currency} ${minorUnitsToMajorString(refund.amountMinorUnits, refund.currency)} (${providerRes.providerRefundId})`,
          },
        });

        if (totalRefundedMinor >= totalCapturedMinor && totalCapturedMinor > 0) {
          await tx.socialTransaction.update({
            where: { id: refund.order.socialTransaction.id },
            data: { status: TransactionStatus.REFUNDED },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          businessId,
          userId: options?.actorUserId || null,
          action: "REFUND_COMPLETED",
          entityType: "REFUND",
          entityId: refund.id,
          metadata: {
            orderId: refund.orderId,
            amountMinorUnits: refund.amountMinorUnits,
            providerRefundId: providerRes.providerRefundId,
          },
        },
      });
    }

    logger.info("refund.processed", {
      refundId: completed.id,
      businessId,
      status: completed.status,
      amountMinorUnits: completed.amountMinorUnits,
    });

    return completed;
  });
}

export async function getRefunds(
  businessId: string,
  filter?: {
    orderId?: string;
    status?: RefundStatus;
    type?: RefundType;
    page?: number;
    limit?: number;
  }
) {
  const page = Math.max(1, filter?.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.RefundWhereInput = {
    businessId,
    ...(filter?.orderId ? { orderId: filter.orderId } : {}),
    ...(filter?.status ? { status: filter.status } : {}),
    ...(filter?.type ? { type: filter.type } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.refund.count({ where }),
    prisma.refund.findMany({
      where,
      include: {
        order: { select: { id: true, orderNumber: true, totalAmount: true, currency: true } },
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

export async function getRefundById(businessId: string, refundId: string) {
  const refund = await prisma.refund.findFirst({
    where: { id: refundId, businessId },
    include: {
      order: { select: { id: true, orderNumber: true, totalAmount: true, amountPaid: true, currency: true } },
      payment: true,
      paymentIntent: true,
      returnRequest: true,
      ledgerEntries: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!refund) {
    throw new NotFoundError("Refund not found in business tenant");
  }
  return refund;
}
