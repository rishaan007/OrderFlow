import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateSellerProfile,
  submitSellerVerification,
  reviewSellerVerification,
  updateSellerNetworkProfile,
} from "@/lib/reputation";
import {
  sellerVerificationRequestSchema,
  updateSellerNetworkProfileSchema,
} from "@/lib/validations";
import { handleApiError, ForbiddenError } from "@/lib/errors";
import { MemberRole, SellerVerificationTier } from "@prisma/client";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const [profile, verifications] = await Promise.all([
      getOrCreateSellerProfile(businessId),
      prisma.sellerVerification.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: { profile, verifications },
    });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/seller/verification" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId, [MemberRole.OWNER, MemberRole.ADMIN]);

    const body = await req.json();

    // Admin moderation approval flow
    if (body.action === "REVIEW_VERIFICATION" && body.verificationId) {
      if (session.user.systemRole !== "ADMIN" && session.user.systemRole !== "SUPER_ADMIN") {
        throw new ForbiddenError("Only platform administrators can review verification submissions");
      }
      const reviewed = await reviewSellerVerification(body.verificationId, {
        status: body.status === "REJECTED" ? "REJECTED" : "VERIFIED",
        verifiedBy: session.user.id,
        reviewerNotes: body.reviewerNotes,
      });
      return NextResponse.json({ success: true, data: reviewed });
    }

    const parsed = sellerVerificationRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const created = await submitSellerVerification(businessId, {
      ...parsed.data,
      requestedTier: parsed.data.requestedTier as SellerVerificationTier,
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/seller/verification" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
      MemberRole.MANAGER,
    ]);

    const body = await req.json();
    const parsed = updateSellerNetworkProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid profile input" },
        { status: 400 }
      );
    }

    const updated = await updateSellerNetworkProfile(businessId, parsed.data);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, { action: "PATCH /api/seller/verification" });
  }
}
