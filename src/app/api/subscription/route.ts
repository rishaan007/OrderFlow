import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { getSubscriptionUsage, updateSubscriptionPlan, PLAN_CONFIGS } from "@/lib/subscriptions";
import { SubscriptionPlan, MemberRole } from "@prisma/client";
import { handleApiError, ForbiddenError } from "@/lib/errors";
import { logAuditEvent, hasMinimumRole } from "@/lib/team";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "No active business workspace selected" }, { status: 404 });
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const usage = await getSubscriptionUsage(businessId);

    return NextResponse.json(
      {
        success: true,
        data: {
          ...usage,
          availablePlans: Object.entries(PLAN_CONFIGS).map(([planKey, config]) => ({
            plan: planKey,
            ...config,
          })),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error, { action: "GET_SUBSCRIPTION" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "No active business workspace selected" }, { status: 404 });
    }

    const businessId = session.activeBusiness.businessId;
    const member = await prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId: session.user.id } },
    });

    if (!member || !hasMinimumRole(member.role, MemberRole.ADMIN)) {
      throw new ForbiddenError("Only workspace Owners and Admins can update the subscription plan");
    }

    const body = await req.json();
    const targetPlan = body.plan as SubscriptionPlan;

    if (!targetPlan || !Object.values(SubscriptionPlan).includes(targetPlan)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid plan specified. Choose from: ${Object.values(SubscriptionPlan).join(", ")}`,
        },
        { status: 400 }
      );
    }

    const updatedUsage = await updateSubscriptionPlan(businessId, targetPlan);

    await logAuditEvent(businessId, session.user.id, "SUBSCRIPTION_UPDATED", "SUBSCRIPTION", null, {
      newPlan: targetPlan,
    });

    return NextResponse.json(
      {
        success: true,
        message: `Subscription successfully updated to ${updatedUsage.planName}`,
        data: updatedUsage,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error, { action: "UPDATE_SUBSCRIPTION" });
  }
}
