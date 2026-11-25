import crypto from "crypto";
import { prisma } from "./prisma";
import {
  LedgerDirection,
  LedgerEntryType,
  PaymentProvider,
  Prisma,
} from "@prisma/client";
import { assertValidMinorUnits, normalizeCurrency } from "./money";
import { ValidationError } from "./errors";
import { logger } from "./logger";

export interface LedgerEntryInput {
  businessId: string;
  orderId: string;
  socialTransactionId?: string | null;
  paymentId?: string | null;
  paymentIntentId?: string | null;
  refundId?: string | null;
  transactionGroupId?: string;
  account?: string;
  entryType: LedgerEntryType;
  direction: LedgerDirection;
  amountMinorUnits: number;
  currency: string;
  referenceType: string;
  referenceId: string;
  reversesEntryId?: string | null;
  provider?: PaymentProvider | null;
  providerEventId?: string | null;
  idempotencyKey?: string | null;
  description: string;
  metadata?: Record<string, unknown> | null;
}

export interface BalancedLedgerPairInput {
  businessId: string;
  orderId: string;
  socialTransactionId?: string | null;
  paymentId?: string | null;
  paymentIntentId?: string | null;
  refundId?: string | null;
  entryType: LedgerEntryType;
  debitAccount: string;
  creditAccount: string;
  amountMinorUnits: number;
  currency: string;
  referenceType: string;
  referenceId: string;
  reversesEntryId?: string | null;
  provider?: PaymentProvider | null;
  providerEventId?: string | null;
  idempotencyKeyPrefix?: string | null;
  description: string;
  metadata?: Record<string, unknown> | null;
}

export interface OrderLedgerBalance {
  orderId: string;
  currency: string;
  capturedMinorUnits: number;
  refundedMinorUnits: number;
  feesMinorUnits: number;
  adjustmentsMinorUnits: number;
  netBalanceMinorUnits: number;
  totalDebitsMinorUnits: number;
  totalCreditsMinorUnits: number;
  isDoubleEntryBalanced: boolean;
  entryCount: number;
}

/**
 * Appends a single immutable ledger entry. Never mutates or deletes historical records.
 * Idempotent when idempotencyKey is supplied.
 */
export async function appendLedgerEntry(
  input: LedgerEntryInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  assertValidMinorUnits(input.amountMinorUnits, "amountMinorUnits");
  if (input.amountMinorUnits === 0) {
    throw new ValidationError("Ledger entry amountMinorUnits must be greater than zero");
  }

  const currency = normalizeCurrency(input.currency);
  const transactionGroupId = input.transactionGroupId || crypto.randomUUID();

  if (input.idempotencyKey) {
    const existing = await client.ledgerEntry.findUnique({
      where: {
        businessId_idempotencyKey: {
          businessId: input.businessId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      return existing;
    }
  }

  try {
    const entry = await client.ledgerEntry.create({
      data: {
        businessId: input.businessId,
        orderId: input.orderId,
        socialTransactionId: input.socialTransactionId ?? null,
        paymentId: input.paymentId ?? null,
        paymentIntentId: input.paymentIntentId ?? null,
        refundId: input.refundId ?? null,
        transactionGroupId,
        sequenceNumber: 1,
        account: input.account || "ORDER_RECEIVABLE",
        entryType: input.entryType,
        direction: input.direction,
        amountMinorUnits: input.amountMinorUnits,
        currency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reversesEntryId: input.reversesEntryId ?? null,
        provider: input.provider ?? null,
        providerEventId: input.providerEventId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        description: input.description,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    logger.info("ledger.entry_appended", {
      entryId: entry.id,
      businessId: entry.businessId,
      orderId: entry.orderId,
      entryType: entry.entryType,
      direction: entry.direction,
      amountMinorUnits: entry.amountMinorUnits,
      currency: entry.currency,
    });

    return entry;
  } catch (err: any) {
    if (err?.code === "P2002" && input.idempotencyKey) {
      const existing = await client.ledgerEntry.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId: input.businessId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Atomically records a balanced double-entry ledger pair (DEBIT + CREDIT of equal amount).
 * Guarantees SUM(DEBIT) === SUM(CREDIT) within transactionGroupId.
 */
export async function appendBalancedLedgerPair(
  input: BalancedLedgerPairInput,
  client?: Prisma.TransactionClient
) {
  assertValidMinorUnits(input.amountMinorUnits, "amountMinorUnits");
  if (input.amountMinorUnits === 0) {
    throw new ValidationError("Ledger entry amountMinorUnits must be greater than zero");
  }

  const currency = normalizeCurrency(input.currency);
  const transactionGroupId = crypto.randomUUID();
  const debitKey = input.idempotencyKeyPrefix
    ? `${input.idempotencyKeyPrefix}:DEBIT:${input.debitAccount}`
    : null;
  const creditKey = input.idempotencyKeyPrefix
    ? `${input.idempotencyKeyPrefix}:CREDIT:${input.creditAccount}`
    : null;

  const execute = async (tx: Prisma.TransactionClient) => {
    if (debitKey) {
      const existingDebit = await tx.ledgerEntry.findUnique({
        where: {
          businessId_idempotencyKey: {
            businessId: input.businessId,
            idempotencyKey: debitKey,
          },
        },
      });
      if (existingDebit) {
        const groupEntries = await tx.ledgerEntry.findMany({
          where: { transactionGroupId: existingDebit.transactionGroupId },
          orderBy: { sequenceNumber: "asc" },
        });
        return groupEntries;
      }
    }

    const debitEntry = await tx.ledgerEntry.create({
      data: {
        businessId: input.businessId,
        orderId: input.orderId,
        socialTransactionId: input.socialTransactionId ?? null,
        paymentId: input.paymentId ?? null,
        paymentIntentId: input.paymentIntentId ?? null,
        refundId: input.refundId ?? null,
        transactionGroupId,
        sequenceNumber: 1,
        account: input.debitAccount,
        entryType: input.entryType,
        direction: LedgerDirection.DEBIT,
        amountMinorUnits: input.amountMinorUnits,
        currency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reversesEntryId: input.reversesEntryId ?? null,
        provider: input.provider ?? null,
        providerEventId: input.providerEventId ?? null,
        idempotencyKey: debitKey,
        description: input.description,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const creditEntry = await tx.ledgerEntry.create({
      data: {
        businessId: input.businessId,
        orderId: input.orderId,
        socialTransactionId: input.socialTransactionId ?? null,
        paymentId: input.paymentId ?? null,
        paymentIntentId: input.paymentIntentId ?? null,
        refundId: input.refundId ?? null,
        transactionGroupId,
        sequenceNumber: 2,
        account: input.creditAccount,
        entryType: input.entryType,
        direction: LedgerDirection.CREDIT,
        amountMinorUnits: input.amountMinorUnits,
        currency,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reversesEntryId: input.reversesEntryId ?? null,
        provider: input.provider ?? null,
        providerEventId: input.providerEventId ?? null,
        idempotencyKey: creditKey,
        description: input.description,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    logger.info("ledger.balanced_pair_appended", {
      transactionGroupId,
      businessId: input.businessId,
      orderId: input.orderId,
      entryType: input.entryType,
      amountMinorUnits: input.amountMinorUnits,
      currency,
    });

    return [debitEntry, creditEntry];
  };

  if (client) {
    return execute(client);
  }
  return prisma.$transaction(execute);
}

/**
 * Records a compensating reversal entry pair for an erroneous or reversed historical ledger group/entry.
 * Original entries remain completely untouched and immutable.
 */
export async function createCompensatingEntry(
  businessId: string,
  originalEntryId: string,
  reason: string,
  options?: { idempotencyKey?: string; actorId?: string },
  client?: Prisma.TransactionClient
) {
  if (!reason || reason.trim().length < 3) {
    throw new ValidationError("Compensating entry requires a clear reason");
  }

  const execute = async (tx: Prisma.TransactionClient) => {
    const original = await tx.ledgerEntry.findFirst({
      where: { id: originalEntryId, businessId },
    });

    if (!original) {
      throw new ValidationError("Original ledger entry not found in business tenant");
    }

    const existingReversal = await tx.ledgerEntry.findFirst({
      where: { businessId, reversesEntryId: originalEntryId },
    });
    if (existingReversal) {
      return tx.ledgerEntry.findMany({
        where: { transactionGroupId: existingReversal.transactionGroupId },
        orderBy: { sequenceNumber: "asc" },
      });
    }

    // Reverse the entire transactionGroupId if it has a matching counterpart, or reverse single entry cleanly
    const groupEntries = await tx.ledgerEntry.findMany({
      where: { businessId, transactionGroupId: original.transactionGroupId },
      orderBy: { sequenceNumber: "asc" },
    });

    const newGroupId = crypto.randomUUID();
    const created: typeof groupEntries = [];
    let seq = 1;

    for (const entry of groupEntries) {
      const invertedDirection =
        entry.direction === LedgerDirection.DEBIT
          ? LedgerDirection.CREDIT
          : LedgerDirection.DEBIT;

      const key = options?.idempotencyKey
        ? `${options.idempotencyKey}:${entry.id}:${invertedDirection}`
        : null;

      const rev = await tx.ledgerEntry.create({
        data: {
          businessId,
          orderId: entry.orderId,
          socialTransactionId: entry.socialTransactionId,
          paymentId: entry.paymentId,
          paymentIntentId: entry.paymentIntentId,
          refundId: entry.refundId,
          transactionGroupId: newGroupId,
          sequenceNumber: seq++,
          account: entry.account,
          entryType: LedgerEntryType.REVERSAL,
          direction: invertedDirection,
          amountMinorUnits: entry.amountMinorUnits,
          currency: entry.currency,
          referenceType: "LEDGER_REVERSAL",
          referenceId: entry.id,
          reversesEntryId: entry.id,
          provider: entry.provider,
          idempotencyKey: key,
          description: `Reversal of ${entry.entryType} (${entry.id}): ${reason.trim()}`,
          metadata: {
            reversedTransactionGroupId: entry.transactionGroupId,
            actorId: options?.actorId || "SYSTEM",
            reason: reason.trim(),
          },
        },
      });
      created.push(rev);
    }

    logger.info("ledger.compensating_reversal", {
      businessId,
      originalEntryId,
      newGroupId,
      count: created.length,
    });

    return created;
  };

  if (client) {
    return execute(client);
  }
  return prisma.$transaction(execute);
}

/**
 * Computes authoritative order financial balance from append-only ledger entries.
 */
export async function getOrderLedgerBalance(
  businessId: string,
  orderId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<OrderLedgerBalance> {
  const order = await client.order.findFirst({
    where: { id: orderId, businessId },
    select: { id: true, currency: true },
  });

  const entries = await client.ledgerEntry.findMany({
    where: { businessId, orderId },
    orderBy: { createdAt: "asc" },
  });

  let capturedMinorUnits = 0;
  let refundedMinorUnits = 0;
  let feesMinorUnits = 0;
  let adjustmentsMinorUnits = 0;
  let totalDebitsMinorUnits = 0;
  let totalCreditsMinorUnits = 0;

  for (const e of entries) {
    if (e.direction === LedgerDirection.DEBIT) {
      totalDebitsMinorUnits += e.amountMinorUnits;
    } else {
      totalCreditsMinorUnits += e.amountMinorUnits;
    }

    // ORDER_RECEIVABLE tracks customer/order net inflows (CREDIT) vs outflows/refunds (DEBIT)
    if (e.account === "ORDER_RECEIVABLE") {
      if (
        e.entryType === LedgerEntryType.PAYMENT_CAPTURED ||
        e.entryType === LedgerEntryType.PAYMENT_RECEIVED
      ) {
        if (e.direction === LedgerDirection.CREDIT) {
          capturedMinorUnits += e.amountMinorUnits;
        } else {
          capturedMinorUnits -= e.amountMinorUnits;
        }
      } else if (
        e.entryType === LedgerEntryType.REFUND_COMPLETED ||
        e.entryType === LedgerEntryType.REFUND_ISSUED
      ) {
        if (e.direction === LedgerDirection.DEBIT) {
          refundedMinorUnits += e.amountMinorUnits;
        } else {
          refundedMinorUnits -= e.amountMinorUnits;
        }
      } else if (e.entryType === LedgerEntryType.REVERSAL) {
        if (e.direction === LedgerDirection.DEBIT) {
          adjustmentsMinorUnits -= e.amountMinorUnits;
        } else {
          adjustmentsMinorUnits += e.amountMinorUnits;
        }
      } else if (e.entryType === LedgerEntryType.FEE) {
        if (e.direction === LedgerDirection.DEBIT) {
          feesMinorUnits += e.amountMinorUnits;
        } else {
          feesMinorUnits -= e.amountMinorUnits;
        }
      } else {
        if (e.direction === LedgerDirection.CREDIT) {
          adjustmentsMinorUnits += e.amountMinorUnits;
        } else {
          adjustmentsMinorUnits -= e.amountMinorUnits;
        }
      }
    }
  }

  const netBalanceMinorUnits =
    capturedMinorUnits - refundedMinorUnits + adjustmentsMinorUnits - feesMinorUnits;

  return {
    orderId,
    currency: entries[0]?.currency || order?.currency || "USD",
    capturedMinorUnits: Math.max(0, capturedMinorUnits),
    refundedMinorUnits: Math.max(0, refundedMinorUnits),
    feesMinorUnits,
    adjustmentsMinorUnits,
    netBalanceMinorUnits,
    totalDebitsMinorUnits,
    totalCreditsMinorUnits,
    isDoubleEntryBalanced: totalDebitsMinorUnits === totalCreditsMinorUnits,
    entryCount: entries.length,
  };
}

/**
 * Validates all ledger accounting invariants for a business or specific order.
 */
export async function validateLedgerInvariants(
  businessId: string,
  orderId?: string
): Promise<{
  valid: boolean;
  violations: string[];
  checkedOrders: number;
  totalDebitsMinorUnits: number;
  totalCreditsMinorUnits: number;
}> {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      businessId,
      ...(orderId ? { orderId } : {}),
    },
  });

  const violations: string[] = [];
  const byGroup = new Map<string, { debit: number; credit: number; currency: string }>();
  const orderIds = new Set<string>();

  let totalDebits = 0;
  let totalCredits = 0;

  for (const entry of entries) {
    orderIds.add(entry.orderId);
    if (entry.amountMinorUnits <= 0) {
      violations.push(`Entry ${entry.id} has non-positive amountMinorUnits=${entry.amountMinorUnits}`);
    }

    if (entry.direction === LedgerDirection.DEBIT) {
      totalDebits += entry.amountMinorUnits;
    } else {
      totalCredits += entry.amountMinorUnits;
    }

    const g = byGroup.get(entry.transactionGroupId) || {
      debit: 0,
      credit: 0,
      currency: entry.currency,
    };
    if (g.currency !== entry.currency) {
      violations.push(`Group ${entry.transactionGroupId} mixes currencies ${g.currency} and ${entry.currency}`);
    }
    if (entry.direction === LedgerDirection.DEBIT) {
      g.debit += entry.amountMinorUnits;
    } else {
      g.credit += entry.amountMinorUnits;
    }
    byGroup.set(entry.transactionGroupId, g);
  }

  for (const [groupId, totals] of Array.from(byGroup.entries())) {
    if (totals.debit !== totals.credit) {
      violations.push(
        `Transaction group ${groupId} is unbalanced: DEBIT=${totals.debit}, CREDIT=${totals.credit}`
      );
    }
  }

  for (const oid of Array.from(orderIds)) {
    const balance = await getOrderLedgerBalance(businessId, oid);
    if (balance.refundedMinorUnits > balance.capturedMinorUnits) {
      violations.push(
        `Order ${oid} refundedMinorUnits (${balance.refundedMinorUnits}) exceeds capturedMinorUnits (${balance.capturedMinorUnits})`
      );
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    checkedOrders: orderIds.size,
    totalDebitsMinorUnits: totalDebits,
    totalCreditsMinorUnits: totalCredits,
  };
}

/**
 * Lists immutable ledger entries scoped strictly to tenant businessId.
 */
export async function getLedgerEntries(
  businessId: string,
  filter?: {
    orderId?: string;
    paymentIntentId?: string;
    refundId?: string;
    entryType?: LedgerEntryType;
    account?: string;
    page?: number;
    limit?: number;
  }
) {
  const page = Math.max(1, filter?.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter?.limit ?? 50));
  const skip = (page - 1) * limit;

  const where: Prisma.LedgerEntryWhereInput = {
    businessId,
    ...(filter?.orderId ? { orderId: filter.orderId } : {}),
    ...(filter?.paymentIntentId ? { paymentIntentId: filter.paymentIntentId } : {}),
    ...(filter?.refundId ? { refundId: filter.refundId } : {}),
    ...(filter?.entryType ? { entryType: filter.entryType } : {}),
    ...(filter?.account ? { account: filter.account } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({
      where,
      include: {
        order: {
          select: { id: true, orderNumber: true, currency: true },
        },
      },
      orderBy: [{ createdAt: "desc" }, { sequenceNumber: "asc" }],
      skip,
      take: limit,
    }),
  ]);

  return {
    items,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
