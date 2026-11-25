import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { getSellerTrustProfile } from "@/lib/trust-profile";

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
    const windowDaysParam = searchParams.get("windowDays");
    const windowDays = windowDaysParam ? parseInt(windowDaysParam, 10) : undefined;

    const profile = await getSellerTrustProfile(businessId, { windowDays });

    return NextResponse.json({
      success: true,
      data: {
        businessId,
        businessName: profile.businessName,
        modelVersion: profile.modelVersion,
        calculatedAt: profile.calculatedAt,
        metrics: profile.metrics,
      },
    });
  } catch (error: any) {
    const status = error.message?.includes("Access denied") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to retrieve trust metrics" },
      { status }
    );
  }
}
