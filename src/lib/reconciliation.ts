import { prisma } from "./prisma";
import {
  ReconciliationType,
  ReconciliationStatus,
  PaymentIntentStatus,
  PaymentRecordStatus,
  PaymentProvider,
  RefundStatus,
  ShipmentStatus,
  LedgerEntryType,
  Prisma,
} from "@prisma/client";
import { toMinorUnits, normalizeCurrency } from "./money";
import { mapShipmentStatusToFulfillmentStatus } from "./state-machines";
import { NotFoundError } from "./errors";
import { logger } from "./logger";

export interface ProviderSettlementRecord {
  provider: string;
  providerEntityId: string;
  providerOrderId?: string;
  orderId?: string;
  amountMinorUnits: number;
  currency: string;
  status: string;
  occurredAt?: Date;
}

export interface RunReconciliationOptions {
  provider?: string;
  windowStart?: Date;
  windowEnd?: Date;
  providerRecords?: ProviderSettlementRecord[];
}

/**
 * Reconciles internal PaymentIntents / Payments / Ledger against observed provider events
 * (webhooks or supplied provider settlement records), classifying matched & discrepancy states.
 */
export async function reconcilePayments(
  businessId: string,
  options?: RunReconciliationOptions
) {
  const windowEnd = options?.windowEnd ?? new Date();
  const windowStart =
    options?.windowStart ?? new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [intents, payments, ledgerCredits, webhookEvents] = await Promise.all([
    prisma.paymentIntent.findMany({
      where: {
        businessId,
        createdAt: { gte: windowStart, lte: windowEnd },
        ...(options?.provider
          ? { provider: options.provider as PaymentProvider }
          : {}),
      },
      include: { attempts: true },
    }),
    prisma.payment.findMany({
      where: {
        businessId,
        createdAt: { gte: windowStart, lte: windowEnd },
        status: PaymentRecordStatus.VERIFIED,
      },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        businessId,
        createdAt: { gte: windowStart, lte: windowEnd },
        account: "ORDER_RECEIVABLE",
        entryType: {
          in: [LedgerEntryType.PAYMENT_CAPTURED, LedgerEntryType.PAYMENT_RECEIVED],
        },
        direction: "CREDIT",
      },
    }),
    prisma.providerWebhookEvent.findMany({
      where: {
        businessId,
        domain: "PAYMENT",
        receivedAt: { gte: windowStart, lte: windowEnd },
        ...(options?.provider ? { provider: options.provider } : {}),
      },
    }),
  ]);

  // Build authoritative list of external provider records either passed explicitly or derived from webhooks
  const externalRecords: ProviderSettlementRecord[] = options?.providerRecords
    ? [...options.providerRecords]
    : webhookEvents
        .filter((ev) => ev.eventType.includes("payment") || ev.eventType.includes("order.paid") || ev.eventType.includes("charge"))
        .map((ev) => {
          const p = (ev.payload || {}) as Record<string, any>;
          const meta = (ev.metadata || {}) as Record<string, any>;
          const amt =
            typeof meta.amountMinorUnits === "number"
              ? meta.amountMinorUnits
              : typeof p.amountMinorUnits === "number"
              ? p.amountMinorUnits
              : 0;
          return {
            provider: ev.provider,
            providerEntityId: String(
              meta.providerPaymentId || ev.normalizedEntityId || ev.providerEventId
            ),
            providerOrderId: meta.providerOrderId
              ? String(meta.providerOrderId)
              : undefined,
            orderId: meta.orderId ? String(meta.orderId) : undefined,
            amountMinorUnits: amt,
            currency: normalizeCurrency(meta.currency || p.currency || "USD"),
            status: ev.eventType,
            occurredAt: ev.occurredAt ?? ev.receivedAt,
          };
        });

  const entriesData: Array<{
    status: ReconciliationStatus;
    internalEntityType?: string;
    internalEntityId?: string;
    providerEntityId?: string;
    expectedAmountMinorUnits?: number;
    actualAmountMinorUnits?: number;
    expectedCurrency?: string;
    actualCurrency?: string;
    expectedState?: string;
    actualState?: string;
    notes: string;
  }> = [];

  const matchedProviderIds = new Set<string>();
  const seenProviderIds = new Map<string, number>();

  for (const rec of externalRecords) {
    seenProviderIds.set(
      rec.providerEntityId,
      (seenProviderIds.get(rec.providerEntityId) || 0) + 1
    );
  }

  // Flag duplicate provider records
  for (const [provId, count] of Array.from(seenProviderIds.entries())) {
    if (count > 1) {
      entriesData.push({
        status: ReconciliationStatus.DUPLICATE,
        providerEntityId: provId,
        notes: `Provider entity ${provId} appeared ${count} times in settlement window`,
      });
    }
  }

  // Check internal captured intents against provider records & ledger
  for (const intent of intents) {
    const ledgerSum = ledgerCredits
      .filter((le) => le.paymentIntentId === intent.id)
      .reduce((acc, le) => acc + le.amountMinorUnits, 0);

    // First verify internal Ledger consistency vs PaymentIntent capturedMinorUnits
    if (intent.capturedMinorUnits > 0 && ledgerSum !== intent.capturedMinorUnits) {
      entriesData.push({
        status: ReconciliationStatus.AMOUNT_MISMATCH,
        internalEntityType: "PAYMENT_INTENT",
        internalEntityId: intent.id,
        expectedAmountMinorUnits: intent.capturedMinorUnits,
        actualAmountMinorUnits: ledgerSum,
        expectedCurrency: intent.currency,
        actualCurrency: intent.currency,
        expectedState: intent.status,
        notes: `Ledger captured sum (${ledgerSum}) mismatches PaymentIntent.capturedMinorUnits (${intent.capturedMinorUnits})`,
      });
      continue;
    }

    const attemptProviderIds = intent.attempts
      .map((a) => a.providerPaymentId)
      .filter((id): id is string => Boolean(id));

    const matchingExt = externalRecords.find(
      (r) =>
        attemptProviderIds.includes(r.providerEntityId) ||
        (r.providerOrderId && intent.providerOrderId === r.providerOrderId)
    );

    if (matchingExt) {
      matchedProviderIds.add(matchingExt.providerEntityId);
      const extCurrency = normalizeCurrency(matchingExt.currency);

      if (extCurrency !== intent.currency) {
        entriesData.push({
          status: ReconciliationStatus.CURRENCY_MISMATCH,
          internalEntityType: "PAYMENT_INTENT",
          internalEntityId: intent.id,
          providerEntityId: matchingExt.providerEntityId,
          expectedAmountMinorUnits: intent.capturedMinorUnits,
          actualAmountMinorUnits: matchingExt.amountMinorUnits,
          expectedCurrency: intent.currency,
          actualCurrency: extCurrency,
          notes: `Currency mismatch: internal ${intent.currency} vs provider ${extCurrency}`,
        });
      } else if (
        intent.capturedMinorUnits !== matchingExt.amountMinorUnits &&
        intent.status !== PaymentIntentStatus.FAILED &&
        intent.status !== PaymentIntentStatus.CANCELLED
      ) {
        entriesData.push({
          status: ReconciliationStatus.AMOUNT_MISMATCH,
          internalEntityType: "PAYMENT_INTENT",
          internalEntityId: intent.id,
          providerEntityId: matchingExt.providerEntityId,
          expectedAmountMinorUnits: intent.capturedMinorUnits,
          actualAmountMinorUnits: matchingExt.amountMinorUnits,
          expectedCurrency: intent.currency,
          actualCurrency: extCurrency,
          notes: `Amount mismatch: internal captured=${intent.capturedMinorUnits}, provider=${matchingExt.amountMinorUnits}`,
        });
      } else {
        entriesData.push({
          status: ReconciliationStatus.MATCHED,
          internalEntityType: "PAYMENT_INTENT",
          internalEntityId: intent.id,
          providerEntityId: matchingExt.providerEntityId,
          expectedAmountMinorUnits: intent.capturedMinorUnits,
          actualAmountMinorUnits: matchingExt.amountMinorUnits,
          expectedCurrency: intent.currency,
          actualCurrency: extCurrency,
          expectedState: intent.status,
          actualState: matchingExt.status,
          notes: "PaymentIntent matched provider record and ledger",
        });
      }
    } else if (
      intent.provider !== PaymentProvider.MANUAL &&
      (intent.status === PaymentIntentStatus.CAPTURED ||
        intent.status === PaymentIntentStatus.PARTIALLY_CAPTURED)
    ) {
      if (externalRecords.length > 0 || options?.providerRecords !== undefined) {
        entriesData.push({
          status: ReconciliationStatus.MISSING_PROVIDER,
          internalEntityType: "PAYMENT_INTENT",
          internalEntityId: intent.id,
          expectedAmountMinorUnits: intent.capturedMinorUnits,
          expectedCurrency: intent.currency,
          expectedState: intent.status,
          notes: `Captured external PaymentIntent (${intent.provider}) missing from provider records`,
        });
      } else {
        // Matched against internal ledger
        entriesData.push({
          status: ReconciliationStatus.MATCHED,
          internalEntityType: "PAYMENT_INTENT",
          internalEntityId: intent.id,
          expectedAmountMinorUnits: intent.capturedMinorUnits,
          actualAmountMinorUnits: ledgerSum,
          expectedCurrency: intent.currency,
          actualCurrency: intent.currency,
          expectedState: intent.status,
          notes: "PaymentIntent matches internal double-entry ledger",
        });
      }
    }
  }

  // Also inspect verified legacy Payment rows that don't belong to a PaymentIntent
  for (const pay of payments) {
    if (pay.paymentIntentId) continue;
    const payMinor =
      pay.amountMinorUnits ?? toMinorUnits(pay.amount, pay.currency);

    const matchingExt = pay.providerPaymentId
      ? externalRecords.find((r) => r.providerEntityId === pay.providerPaymentId)
      : undefined;

    if (matchingExt) {
      matchedProviderIds.add(matchingExt.providerEntityId);
      if (matchingExt.amountMinorUnits !== payMinor) {
        entriesData.push({
          status: ReconciliationStatus.AMOUNT_MISMATCH,
          internalEntityType: "PAYMENT",
          internalEntityId: pay.id,
          providerEntityId: matchingExt.providerEntityId,
          expectedAmountMinorUnits: payMinor,
          actualAmountMinorUnits: matchingExt.amountMinorUnits,
          expectedCurrency: pay.currency,
          actualCurrency: matchingExt.currency,
          notes: `Payment amount mismatch: internal=${payMinor}, provider=${matchingExt.amountMinorUnits}`,
        });
      } else {
        entriesData.push({
          status: ReconciliationStatus.MATCHED,
          internalEntityType: "PAYMENT",
          internalEntityId: pay.id,
          providerEntityId: matchingExt.providerEntityId,
          expectedAmountMinorUnits: payMinor,
          actualAmountMinorUnits: matchingExt.amountMinorUnits,
          expectedCurrency: pay.currency,
          actualCurrency: matchingExt.currency,
          notes: "Direct Payment matched provider record",
        });
      }
    } else if (externalRecords.length === 0) {
      entriesData.push({
        status: ReconciliationStatus.MATCHED,
        internalEntityType: "PAYMENT",
        internalEntityId: pay.id,
        expectedAmountMinorUnits: payMinor,
        actualAmountMinorUnits: payMinor,
        expectedCurrency: pay.currency,
        actualCurrency: pay.currency,
        expectedState: pay.status,
        notes: "Verified payment recorded cleanly",
      });
    }
  }

  // Flag any unmatched external provider settlement records as MISSING_INTERNAL
  for (const ext of externalRecords) {
    if (!matchedProviderIds.has(ext.providerEntityId)) {
      entriesData.push({
        status: ReconciliationStatus.MISSING_INTERNAL,
        providerEntityId: ext.providerEntityId,
        actualAmountMinorUnits: ext.amountMinorUnits,
        actualCurrency: ext.currency,
        actualState: ext.status,
        notes: `Provider record ${ext.providerEntityId} (${ext.provider}) has no matching internal PaymentIntent or Payment`,
      });
    }
  }

  const matchedCount = entriesData.filter(
    (e) => e.status === ReconciliationStatus.MATCHED
  ).length;
  const mismatchCount = entriesData.length - matchedCount;

  return prisma.$transaction(async (tx) => {
    const run = await tx.reconciliationRun.create({
      data: {
        businessId,
        type: ReconciliationType.PAYMENT,
        provider: options?.provider ?? null,
        windowStart,
        windowEnd,
        totalRecords: entriesData.length,
        matchedCount,
        mismatchCount,
        unresolvedCount: mismatchCount,
        status: "COMPLETED",
        completedAt: new Date(),
        summary: {
          intentsChecked: intents.length,
          paymentsChecked: payments.length,
          externalRecordsChecked: externalRecords.length,
        },
        entries: {
          create: entriesData.map((e) => ({
            businessId,
            status: e.status,
            internalEntityType: e.internalEntityType ?? null,
            internalEntityId: e.internalEntityId ?? null,
            providerEntityId: e.providerEntityId ?? null,
            expectedAmountMinorUnits: e.expectedAmountMinorUnits ?? null,
            actualAmountMinorUnits: e.actualAmountMinorUnits ?? null,
            expectedCurrency: e.expectedCurrency ?? null,
            actualCurrency: e.actualCurrency ?? null,
            expectedState: e.expectedState ?? null,
            actualState: e.actualState ?? null,
            resolved: e.status === ReconciliationStatus.MATCHED,
            notes: e.notes,
          })),
        },
      },
      include: { entries: true },
    });

    logger.info("reconciliation.payments_completed", {
      runId: run.id,
      businessId,
      totalRecords: run.totalRecords,
      matchedCount: run.matchedCount,
      mismatchCount: run.mismatchCount,
    });

    return run;
  });
}

/**
 * Reconciles internal Refunds against LedgerEntries & Order.refundedAmountMinorUnits.
 */
export async function reconcileRefunds(
  businessId: string,
  options?: RunReconciliationOptions
) {
  const windowEnd = options?.windowEnd ?? new Date();
  const windowStart =
    options?.windowStart ?? new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [refunds, refundLedgerDebits] = await Promise.all([
    prisma.refund.findMany({
      where: {
        businessId,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
    }),
    prisma.ledgerEntry.findMany({
      where: {
        businessId,
        createdAt: { gte: windowStart, lte: windowEnd },
        account: "ORDER_RECEIVABLE",
        entryType: {
          in: [LedgerEntryType.REFUND_COMPLETED, LedgerEntryType.REFUND_ISSUED],
        },
        direction: "DEBIT",
      },
    }),
  ]);

  const entriesData: Array<{
    status: ReconciliationStatus;
    internalEntityType: string;
    internalEntityId: string;
    providerEntityId?: string;
    expectedAmountMinorUnits: number;
    actualAmountMinorUnits: number;
    expectedCurrency: string;
    actualCurrency: string;
    expectedState: string;
    actualState?: string;
    notes: string;
  }> = [];

  for (const r of refunds) {
    const ledgerForRefund = refundLedgerDebits
      .filter((le) => le.refundId === r.id)
      .reduce((acc, le) => acc + le.amountMinorUnits, 0);

    if (r.status === RefundStatus.COMPLETED) {
      if (ledgerForRefund === r.amountMinorUnits) {
        entriesData.push({
          status: ReconciliationStatus.MATCHED,
          internalEntityType: "REFUND",
          internalEntityId: r.id,
          providerEntityId: r.providerRefundId ?? undefined,
          expectedAmountMinorUnits: r.amountMinorUnits,
          actualAmountMinorUnits: ledgerForRefund,
          expectedCurrency: r.currency,
          actualCurrency: r.currency,
          expectedState: r.status,
          notes: "Completed refund matches ledger debit",
        });
      } else {
        entriesData.push({
          status:
            ledgerForRefund === 0
              ? ReconciliationStatus.MISSING_INTERNAL
              : ReconciliationStatus.AMOUNT_MISMATCH,
          internalEntityType: "REFUND",
          internalEntityId: r.id,
          providerEntityId: r.providerRefundId ?? undefined,
          expectedAmountMinorUnits: r.amountMinorUnits,
          actualAmountMinorUnits: ledgerForRefund,
          expectedCurrency: r.currency,
          actualCurrency: r.currency,
          expectedState: r.status,
          notes: `Completed refund ${r.id} has ledger sum ${ledgerForRefund}, expected ${r.amountMinorUnits}`,
        });
      }
    } else if (ledgerForRefund > 0) {
      entriesData.push({
        status: ReconciliationStatus.STATE_MISMATCH,
        internalEntityType: "REFUND",
        internalEntityId: r.id,
        expectedAmountMinorUnits: 0,
        actualAmountMinorUnits: ledgerForRefund,
        expectedCurrency: r.currency,
        actualCurrency: r.currency,
        expectedState: r.status,
        notes: `Non-completed refund (${r.status}) has ledger debit (${ledgerForRefund})`,
      });
    }
  }

  const matchedCount = entriesData.filter(
    (e) => e.status === ReconciliationStatus.MATCHED
  ).length;
  const mismatchCount = entriesData.length - matchedCount;

  return prisma.reconciliationRun.create({
    data: {
      businessId,
      type: ReconciliationType.REFUND,
      provider: options?.provider ?? null,
      windowStart,
      windowEnd,
      totalRecords: entriesData.length,
      matchedCount,
      mismatchCount,
      unresolvedCount: mismatchCount,
      status: "COMPLETED",
      completedAt: new Date(),
      entries: {
        create: entriesData.map((e) => ({
          businessId,
          status: e.status,
          internalEntityType: e.internalEntityType,
          internalEntityId: e.internalEntityId,
          providerEntityId: e.providerEntityId ?? null,
          expectedAmountMinorUnits: e.expectedAmountMinorUnits,
          actualAmountMinorUnits: e.actualAmountMinorUnits,
          expectedCurrency: e.expectedCurrency,
          actualCurrency: e.actualCurrency,
          expectedState: e.expectedState,
          resolved: e.status === ReconciliationStatus.MATCHED,
          notes: e.notes,
        })),
      },
    },
    include: { entries: true },
  });
}

/**
 * Reconciles Shipment status against latest TrackingEvent and Order.fulfillmentStatus.
 */
export async function reconcileShipments(
  businessId: string,
  options?: RunReconciliationOptions
) {
  const windowEnd = options?.windowEnd ?? new Date();
  const windowStart =
    options?.windowStart ?? new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const shipments = await prisma.shipment.findMany({
    where: {
      businessId,
      createdAt: { gte: windowStart, lte: windowEnd },
    },
    include: {
      order: { select: { id: true, status: true, fulfillmentStatus: true } },
      trackingEvents: { orderBy: { occurredAt: "desc" }, take: 1 },
    },
  });

  const entriesData: Array<{
    status: ReconciliationStatus;
    internalEntityType: string;
    internalEntityId: string;
    expectedState: string;
    actualState: string;
    notes: string;
  }> = [];

  for (const s of shipments) {
    const latestEvent = s.trackingEvents[0];
    if (latestEvent && latestEvent.status !== s.status) {
      entriesData.push({
        status: ReconciliationStatus.STATE_MISMATCH,
        internalEntityType: "SHIPMENT",
        internalEntityId: s.id,
        expectedState: latestEvent.status,
        actualState: s.status,
        notes: `Shipment status (${s.status}) differs from latest carrier tracking event (${latestEvent.status})`,
      });
    } else if (
      s.order.fulfillmentStatus &&
      s.order.fulfillmentStatus !== mapShipmentStatusToFulfillmentStatus(s.status)
    ) {
      entriesData.push({
        status: ReconciliationStatus.STATE_MISMATCH,
        internalEntityType: "SHIPMENT",
        internalEntityId: s.id,
        expectedState: mapShipmentStatusToFulfillmentStatus(s.status),
        actualState: s.order.fulfillmentStatus,
        notes: `Order fulfillmentStatus (${s.order.fulfillmentStatus}) mismatches shipment (${s.status})`,
      });
    } else if (
      s.status === ShipmentStatus.LOST ||
      s.status === ShipmentStatus.DAMAGED ||
      s.status === ShipmentStatus.FAILED_ATTEMPT
    ) {
      entriesData.push({
        status: ReconciliationStatus.STATE_MISMATCH,
        internalEntityType: "SHIPMENT",
        internalEntityId: s.id,
        expectedState: ShipmentStatus.DELIVERED,
        actualState: s.status,
        notes: `Shipment exception state requires attention: ${s.status}`,
      });
    } else {
      entriesData.push({
        status: ReconciliationStatus.MATCHED,
        internalEntityType: "SHIPMENT",
        internalEntityId: s.id,
        expectedState: s.status,
        actualState: latestEvent?.status || s.status,
        notes: "Shipment status consistent with tracking events and order fulfillment",
      });
    }
  }

  const matchedCount = entriesData.filter(
    (e) => e.status === ReconciliationStatus.MATCHED
  ).length;
  const mismatchCount = entriesData.length - matchedCount;

  return prisma.reconciliationRun.create({
    data: {
      businessId,
      type: ReconciliationType.SHIPMENT,
      provider: options?.provider ?? null,
      windowStart,
      windowEnd,
      totalRecords: entriesData.length,
      matchedCount,
      mismatchCount,
      unresolvedCount: mismatchCount,
      status: "COMPLETED",
      completedAt: new Date(),
      entries: {
        create: entriesData.map((e) => ({
          businessId,
          status: e.status,
          internalEntityType: e.internalEntityType,
          internalEntityId: e.internalEntityId,
          expectedState: e.expectedState,
          actualState: e.actualState,
          resolved: e.status === ReconciliationStatus.MATCHED,
          notes: e.notes,
        })),
      },
    },
    include: { entries: true },
  });
}

export async function getReconciliationRuns(
  businessId: string,
  filter?: { type?: ReconciliationType; page?: number; limit?: number }
) {
  const page = Math.max(1, filter?.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.ReconciliationRunWhereInput = {
    businessId,
    ...(filter?.type ? { type: filter.type } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.reconciliationRun.count({ where }),
    prisma.reconciliationRun.findMany({
      where,
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

export async function getReconciliationRunById(businessId: string, runId: string) {
  const run = await prisma.reconciliationRun.findFirst({
    where: { id: runId, businessId },
    include: {
      entries: { orderBy: [{ resolved: "asc" }, { createdAt: "desc" }] },
    },
  });
  if (!run) {
    throw new NotFoundError("Reconciliation run not found in business tenant");
  }
  return run;
}

export async function resolveReconciliationEntry(
  businessId: string,
  entryId: string,
  resolutionNotes: string,
  actorUserId?: string
) {
  const entry = await prisma.reconciliationEntry.findFirst({
    where: { id: entryId, businessId },
  });
  if (!entry) {
    throw new NotFoundError("Reconciliation entry not found in business tenant");
  }
  if (entry.resolved) return entry;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.reconciliationEntry.update({
      where: { id: entry.id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolutionNotes: resolutionNotes.trim(),
      },
    });

    await tx.reconciliationRun.update({
      where: { id: entry.runId },
      data: {
        unresolvedCount: { decrement: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        businessId,
        userId: actorUserId || null,
        action: "RECONCILIATION_ENTRY_RESOLVED",
        entityType: "RECONCILIATION_ENTRY",
        entityId: entry.id,
        metadata: {
          runId: entry.runId,
          status: entry.status,
          resolutionNotes: resolutionNotes.trim(),
        },
      },
    });

    return updated;
  });
}
