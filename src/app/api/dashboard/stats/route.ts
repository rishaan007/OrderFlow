import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess, getTenantDb } from "@/lib/tenant";
import { ApiResponse, DashboardStatsResponse } from "@/types";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "No active business found. Please complete onboarding." },
        { status: 404 }
      );
    }

    // Verify tenant access
    await assertBusinessAccess(
      session.user.id,
      session.activeBusiness.businessId
    );

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const stats = await tenantDb.getDashboardStats();

    return NextResponse.json<ApiResponse<DashboardStatsResponse>>(
      {
        success: true,
        data: stats,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
