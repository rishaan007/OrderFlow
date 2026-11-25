import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { TransactionRiskLevel, RiskReviewStatus } from "@prisma/client";
import {
  getBusinessRiskAssessments,
  getBusinessRiskReviews,
} from "@/lib/risk-engine";

export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const riskLevel = (searchParams.get("riskLevel") as TransactionRiskLevel) || undefined;
    const reviewStatus = (searchParams.get("reviewStatus") as RiskReviewStatus) || undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const skip = (page - 1) * limit;

    const [assessments, reviews] = await Promise.all([
      getBusinessRiskAssessments(businessId, { riskLevel, take: limit, skip }),
      getBusinessRiskReviews(businessId, { status: reviewStatus, take: limit, skip }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        assessments: assessments.items,
        totalAssessments: assessments.total,
        reviews: reviews.items,
        totalReviews: reviews.total,
        page,
        limit,
      },
    });
  } catch (error: any) {
    const status = error.message?.includes("Access denied") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to retrieve risk data" },
      { status }
    );
  }
}
