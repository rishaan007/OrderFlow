import {
  prisma,
} from "./prisma";
import {
  TrustSignalCategory,
  TrustSignalDirection,
  TrustSignalSeverity,
  Prisma,
} from "@prisma/client";
import { logger } from "./logger";

export interface RecordTrustSignalInput {
  buyerIdentityId?: string | null;
  businessId?: string | null;
  socialTransactionId?: string | null;
  orderId?: string | null;
  disputeId?: string | null;
  signalType: string;
  category: TrustSignalCategory;
  direction: TrustSignalDirection;
  severity: TrustSignalSeverity;
  scoreValue?: number | null;
  confidence?: number;
  explanation: string;
  sourceType: string;
  sourceId?: string | null;
  sampleSize?: number | null;
  observationWindow?: string | null;
  observedAt?: Date;
  validUntil?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface GetTrustSignalsFilter {
  buyerIdentityId?: string;
  businessId?: string;
  socialTransactionId?: string;
  orderId?: string;
  disputeId?: string;
  category?: TrustSignalCategory;
  direction?: TrustSignalDirection;
  severity?: TrustSignalSeverity;
  activeOnly?: boolean;
  take?: number;
  skip?: number;
}

/**
 * Calculates temporal decay weight for a signal based on half-life formula:
 * weight = 0.5 ^ (ageInDays / halfLifeDays)
 */
export function calculateTemporalWeight(
  observedAt: Date,
  halfLifeDays = 90,
  referenceDate = new Date()
): number {
  const ageMs = Math.max(0, referenceDate.getTime() - observedAt.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Validates whether a trust signal is currently active (not invalidated and not expired).
 */
export function isSignalActive(signal: {
  invalidatedAt?: Date | null;
  validUntil?: Date | null;
}, referenceDate = new Date()): boolean {
  if (signal.invalidatedAt) return false;
  if (signal.validUntil && signal.validUntil.getTime() <= referenceDate.getTime()) {
    return false;
  }
  return true;
}

/**
 * Records a new immutable, provenance-backed trust signal.
 */
export async function recordTrustSignal(
  input: RecordTrustSignalInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (!input.signalType || !input.explanation) {
    throw new Error("signalType and explanation are required for trust signals");
  }

  const confidence = Math.max(0.0, Math.min(1.0, input.confidence ?? 1.0));

  const signal = await client.trustSignal.create({
    data: {
      buyerIdentityId: input.buyerIdentityId ?? null,
      businessId: input.businessId ?? null,
      socialTransactionId: input.socialTransactionId ?? null,
      orderId: input.orderId ?? null,
      disputeId: input.disputeId ?? null,
      signalType: input.signalType,
      category: input.category,
      direction: input.direction,
      severity: input.severity,
      scoreValue: input.scoreValue !== undefined ? input.scoreValue : null,
      confidence,
      explanation: input.explanation,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sampleSize: input.sampleSize ?? null,
      observationWindow: input.observationWindow ?? null,
      observedAt: input.observedAt ?? new Date(),
      validUntil: input.validUntil ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  logger.info("trust_signal.recorded", {
    signalId: signal.id,
    signalType: signal.signalType,
    category: signal.category,
    direction: signal.direction,
    businessId: signal.businessId ?? undefined,
    buyerIdentityId: signal.buyerIdentityId ?? undefined,
  });

  return signal;
}

/**
 * Invalidate an erroneous or superseded trust signal with an auditable reason.
 */
export async function invalidateTrustSignal(
  signalId: string,
  reason: string,
  actorId?: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (!signalId || !reason) {
    throw new Error("signalId and reason are required to invalidate a trust signal");
  }

  const existing = await client.trustSignal.findUnique({
    where: { id: signalId },
  });

  if (!existing) {
    throw new Error("Trust signal not found");
  }

  if (existing.invalidatedAt) {
    return existing; // Idempotent
  }

  const updated = await client.trustSignal.update({
    where: { id: signalId },
    data: {
      invalidatedAt: new Date(),
      invalidationReason: reason,
    },
  });

  await client.trustRiskAuditEvent.create({
    data: {
      businessId: existing.businessId,
      buyerIdentityId: existing.buyerIdentityId,
      transactionId: existing.socialTransactionId,
      eventType: "SIGNAL_INVALIDATED",
      actorType: actorId ? "USER" : "SYSTEM",
      actorId: actorId ?? null,
      previousState: {
        signalId: existing.id,
        signalType: existing.signalType,
        active: true,
      },
      newState: {
        signalId: existing.id,
        signalType: existing.signalType,
        active: false,
        invalidatedAt: updated.invalidatedAt,
      },
      reason,
    },
  });

  logger.info("trust_signal.invalidated", {
    signalId: updated.id,
    reason,
    actorId,
  });

  return updated;
}

/**
 * Retrieves trust signals matching filter criteria.
 */
export async function getTrustSignals(
  filter: GetTrustSignalsFilter,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const where: Prisma.TrustSignalWhereInput = {};

  if (filter.buyerIdentityId) where.buyerIdentityId = filter.buyerIdentityId;
  if (filter.businessId) where.businessId = filter.businessId;
  if (filter.socialTransactionId) where.socialTransactionId = filter.socialTransactionId;
  if (filter.orderId) where.orderId = filter.orderId;
  if (filter.disputeId) where.disputeId = filter.disputeId;
  if (filter.category) where.category = filter.category;
  if (filter.direction) where.direction = filter.direction;
  if (filter.severity) where.severity = filter.severity;

  if (filter.activeOnly) {
    where.invalidatedAt = null;
    where.OR = [
      { validUntil: null },
      { validUntil: { gt: new Date() } },
    ];
  }

  return client.trustSignal.findMany({
    where,
    orderBy: { observedAt: "desc" },
    take: filter.take ? Math.min(200, filter.take) : 50,
    skip: filter.skip ?? 0,
  });
}
