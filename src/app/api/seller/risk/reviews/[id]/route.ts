import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { resolveRiskReviewSchema } from "@/lib/validations";
import { assignRiskReview, resolveRiskReview } from "@/lib/risk-engine";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await req.json();

    // If body contains action: 'ASSIGN'
    if (body.action === "ASSIGN") {
      const assigned = await assignRiskReview(
        businessId,
        params.id,
        body.reviewerUserId || session.user.id
      );
      return NextResponse.json({ success: true, data: assigned });
    }

    const validation = resolveRiskReviewSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || "Invalid review decision data" },
        { status: 400 }
      );
    }

    const resolved = await resolveRiskReview(
      businessId,
      params.id,
      validation.data.decision,
      validation.data.notes,
      session.user.id
    );

    return NextResponse.json({ success: true, data: resolved });
  } catch (error: any) {
    const status = error.message?.includes("Access denied") || error.message?.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update risk review" },
      { status }
    );
  }
}
