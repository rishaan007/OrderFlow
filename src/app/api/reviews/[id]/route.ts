import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import {
  updateBuyerReview,
  addSellerResponseToReview,
  reportReview,
  moderateReview,
} from "@/lib/reviews";
import { updateReviewSchema, reportReviewSchema } from "@/lib/validations";
import { handleApiError, ForbiddenError } from "@/lib/errors";
import { ReviewModerationState } from "@prisma/client";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();

    // Seller response path
    if (body.sellerResponse !== undefined) {
      if (!session.activeBusiness?.businessId) {
        throw new ForbiddenError("Active business required to respond as seller");
      }
      await assertBusinessAccess(session.user.id, session.activeBusiness.businessId);
      const parsed = updateReviewSchema.safeParse({ sellerResponse: body.sellerResponse });
      if (!parsed.success || !parsed.data.sellerResponse) {
        return NextResponse.json(
          { success: false, error: "Valid sellerResponse text required" },
          { status: 400 }
        );
      }
      const updated = await addSellerResponseToReview(
        session.activeBusiness.businessId,
        session.user.id,
        params.id,
        parsed.data.sellerResponse
      );
      return NextResponse.json({ success: true, data: updated });
    }

    // Platform moderation path
    if (body.moderationState !== undefined) {
      if (session.user.systemRole !== "ADMIN" && session.user.systemRole !== "SUPER_ADMIN") {
        throw new ForbiddenError("Sellers cannot moderate or delete reviews");
      }
      const updated = await moderateReview(params.id, session.user.id, {
        moderationState: body.moderationState as ReviewModerationState,
        moderationNotes: body.moderationNotes,
      });
      return NextResponse.json({ success: true, data: updated });
    }

    // Buyer edit within window
    const parsed = updateReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid update" },
        { status: 400 }
      );
    }

    const updated = await updateBuyerReview(session.user.id, params.id, parsed.data);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, { action: "PATCH /api/reviews/[id]" });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = reportReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid report" },
        { status: 400 }
      );
    }

    const reporterType = session.activeBusiness?.businessId ? "SELLER" : "BUYER";
    const report = await reportReview({
      reviewId: params.id,
      reporterType,
      reporterId: session.user.id,
      reason: parsed.data.reason,
      details: parsed.data.details,
    });

    return NextResponse.json({ success: true, data: report }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/reviews/[id]" });
  }
}
