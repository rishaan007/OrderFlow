import { NextRequest, NextResponse } from "next/server";
import { AbuseActionType, AbuseTargetType } from "@prisma/client";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { getOrCreateBuyerIdentity } from "@/lib/buyer-identity";
import {
  applyAbuseAction,
  flagPlatformAbuse,
  listAbuseCases,
} from "@/lib/platform-abuse";
import { prisma } from "@/lib/prisma";
import { checkDistributedRateLimit } from "@/lib/rate-limiter";
import { ForbiddenError, handleApiError, NotFoundError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const isAdmin =
      session.user.systemRole === "ADMIN" || session.user.systemRole === "SUPER_ADMIN";
    if (!isAdmin) {
      throw new ForbiddenError("Only platform moderators may list platform abuse cases");
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const targetType = (searchParams.get("targetType") as AbuseTargetType) || undefined;
    const limit = parseInt(searchParams.get("limit") || "25", 10) || 25;

    const cases = await listAbuseCases({ status, targetType, limit });
    return NextResponse.json({ success: true, data: cases });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/platform/abuse" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rate = await checkDistributedRateLimit(req, {
      keyPrefix: "platform-abuse-flag",
      limit: 15,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many abuse report requests" },
        { status: 429, headers: rate.headers }
      );
    }

    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const targetType = body?.targetType as AbuseTargetType | undefined;
    const targetId = body?.targetId as string | undefined;
    const reason = body?.reason as string | undefined;
    const category = body?.category as string | undefined;

    if (!targetType || !Object.values(AbuseTargetType).includes(targetType)) {
      throw new ValidationError("Valid targetType is required");
    }
    if (!targetId || !reason || reason.trim().length < 3 || !category) {
      throw new ValidationError("targetId, category, and reason are required");
    }

    const isAdmin =
      session.user.systemRole === "ADMIN" || session.user.systemRole === "SUPER_ADMIN";
    const communityReportable: AbuseTargetType[] = [
      AbuseTargetType.REVIEW,
      AbuseTargetType.LISTING,
      AbuseTargetType.SELLER,
    ];
    if (!isAdmin && !communityReportable.includes(targetType)) {
      throw new ForbiddenError("Only moderators may flag this target type");
    }

    const created = await flagPlatformAbuse({
      targetType,
      targetId,
      businessId: body.businessId || null,
      buyerIdentityId: body.buyerIdentityId || null,
      reason: reason.trim(),
      category,
      severity: isAdmin ? body.severity || "MEDIUM" : "MEDIUM",
      evidence: body.evidence || {},
      actorId: session.user.id,
    });

    return NextResponse.json({ success: true, data: created }, { status: 201, headers: rate.headers });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/platform/abuse" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const caseId = body?.caseId as string | undefined;
    const action = body?.action as AbuseActionType | undefined;
    const notes = body?.notes as string | undefined;

    if (!caseId || !action || !Object.values(AbuseActionType).includes(action) || !notes) {
      throw new ValidationError("caseId, valid action, and notes are required");
    }

    const isAdmin =
      session.user.systemRole === "ADMIN" || session.user.systemRole === "SUPER_ADMIN";

    if (action === AbuseActionType.APPEAL) {
      const abuseCase = await prisma.platformAbuseCase.findUnique({ where: { id: caseId } });
      if (!abuseCase) throw new NotFoundError("Platform abuse case not found");

      if (!isAdmin) {
        let ownsTarget = false;
        if (abuseCase.businessId) {
          await assertBusinessAccess(session.user.id, abuseCase.businessId).catch(() => {});
          const member = await prisma.businessMember.findUnique({
            where: {
              businessId_userId: { businessId: abuseCase.businessId, userId: session.user.id },
            },
          });
          if (member) ownsTarget = true;
        }
        if (abuseCase.buyerIdentityId) {
          const identity = await getOrCreateBuyerIdentity(session.user.id).catch(() => null);
          if (identity?.id === abuseCase.buyerIdentityId) ownsTarget = true;
        }
        if (!ownsTarget) {
          throw new ForbiddenError("You can only submit an appeal for your own account or business");
        }
      }
    } else if (!isAdmin) {
      throw new ForbiddenError("Moderator privileges required to update abuse case status");
    }

    const updated = await applyAbuseAction(caseId, {
      action,
      actorId: session.user.id,
      notes: notes.trim(),
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, { action: "PATCH /api/platform/abuse" });
  }
}
