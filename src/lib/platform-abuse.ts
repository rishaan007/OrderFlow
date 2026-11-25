import {
  AbuseActionType,
  AbuseTargetType,
  AccountLifecycleStatus,
  BuyerIdentityStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "./prisma";
import { NotFoundError } from "./errors";

export async function flagPlatformAbuse(input: {
  targetType: AbuseTargetType;
  targetId: string;
  businessId?: string | null;
  buyerIdentityId?: string | null;
  reason: string;
  category: string;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  evidence?: Record<string, unknown>;
  actorId?: string | null;
}) {
  const entry = {
    action: AbuseActionType.FLAG,
    actorId: input.actorId ?? "SYSTEM",
    at: new Date().toISOString(),
    notes: input.reason,
  };

  return prisma.platformAbuseCase.create({
    data: {
      targetType: input.targetType,
      targetId: input.targetId,
      businessId: input.businessId ?? null,
      buyerIdentityId: input.buyerIdentityId ?? null,
      reason: input.reason,
      category: input.category,
      severity: input.severity ?? "MEDIUM",
      status: "OPEN",
      actionTaken: AbuseActionType.FLAG,
      evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      auditTrail: [entry] as Prisma.InputJsonValue,
    },
  });
}

/**
 * Auditable, human-reviewable abuse workflow supporting:
 * FLAG | REVIEW | LIMIT | SUSPEND | APPEAL | RESOLVE.
 * Never executes opaque permanent auto-bans without an explicit audit trail.
 */
export async function applyAbuseAction(
  caseId: string,
  input: {
    action: AbuseActionType;
    actorId: string;
    notes: string;
  }
) {
  const abuseCase = await prisma.platformAbuseCase.findUnique({ where: { id: caseId } });
  if (!abuseCase) throw new NotFoundError("Platform abuse case not found");

  const prevTrail = Array.isArray(abuseCase.auditTrail) ? (abuseCase.auditTrail as any[]) : [];
  const nextTrail = [
    ...prevTrail,
    {
      action: input.action,
      actorId: input.actorId,
      at: new Date().toISOString(),
      notes: input.notes,
    },
  ];

  const statusMap: Record<AbuseActionType, string> = {
    FLAG: "OPEN",
    REVIEW: "UNDER_REVIEW",
    LIMIT: "LIMITED",
    SUSPEND: "SUSPENDED",
    APPEAL: "APPEALED",
    RESOLVE: "RESOLVED",
  };

  const nextStatus = statusMap[input.action];

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.platformAbuseCase.update({
      where: { id: caseId },
      data: {
        status: nextStatus,
        actionTaken: input.action,
        auditTrail: nextTrail as Prisma.InputJsonValue,
        ...(input.action === AbuseActionType.APPEAL ? { appealNotes: input.notes } : {}),
        ...(input.action === AbuseActionType.RESOLVE ? { resolvedAt: new Date() } : {}),
      },
    });

    if (input.action === AbuseActionType.SUSPEND) {
      if (abuseCase.targetType === AbuseTargetType.SELLER) {
        await tx.business.updateMany({
          where: { id: abuseCase.targetId },
          data: { accountStatus: AccountLifecycleStatus.SUSPENDED },
        });
        await tx.sellerProfile.updateMany({
          where: { businessId: abuseCase.targetId },
          data: { accountStatus: AccountLifecycleStatus.SUSPENDED },
        });
        await tx.marketplaceListing.updateMany({
          where: { businessId: abuseCase.targetId },
          data: { discoverable: false },
        });
      } else if (abuseCase.targetType === AbuseTargetType.BUYER) {
        await tx.buyerIdentity.updateMany({
          where: { id: abuseCase.targetId },
          data: { status: BuyerIdentityStatus.SUSPENDED, accountState: "SUSPENDED" },
        });
      } else if (abuseCase.targetType === AbuseTargetType.LISTING) {
        await tx.marketplaceListing.updateMany({
          where: { productId: abuseCase.targetId },
          data: { discoverable: false },
        });
      }
    }

    if (input.action === AbuseActionType.RESOLVE) {
      if (abuseCase.targetType === AbuseTargetType.SELLER) {
        await tx.business.updateMany({
          where: { id: abuseCase.targetId },
          data: { accountStatus: AccountLifecycleStatus.ACTIVE },
        });
        await tx.sellerProfile.updateMany({
          where: { businessId: abuseCase.targetId },
          data: { accountStatus: AccountLifecycleStatus.ACTIVE },
        });
      }
    }

    return res;
  });

  return updated;
}

export async function listAbuseCases(params?: {
  status?: string;
  targetType?: AbuseTargetType;
  limit?: number;
}) {
  return prisma.platformAbuseCase.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.targetType ? { targetType: params.targetType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, params?.limit ?? 25)),
  });
}
