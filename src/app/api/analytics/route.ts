import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess, getTenantDb } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limiter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const rateLimit = checkRateLimit(req, { limit: 120, windowMs: 60000, keyPrefix: "analytics" });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded. Please try again shortly." },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "No active business workspace selected" },
        { status: 404 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const daysParam = searchParams.get("days");
    const days = daysParam ? parseInt(daysParam, 10) : 30;
    const validDays = isNaN(days) ? 30 : Math.min(365, Math.max(1, days));

    const tenantDb = getTenantDb(businessId);

    const [revenue, productPerformance, customerRetention, paymentReport] = await Promise.all([
      tenantDb.getRevenueAnalytics({ days: validDays }),
      tenantDb.getProductPerformance(),
      tenantDb.getCustomerRetention(),
      tenantDb.getPaymentReport(),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: {
          periodDays: validDays,
          revenue,
          productPerformance,
          customerRetention,
          paymentReport,
        },
      },
      { status: 200, headers: rateLimit.headers }
    );
  } catch (error) {
    return handleApiError(error, { action: "GET_ANALYTICS" });
  }
}
