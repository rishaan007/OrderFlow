import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { exportSellerTenantData, SellerExportEntity } from "@/lib/export-portability";
import { checkDistributedRateLimit } from "@/lib/rate-limiter";
import { handleApiError } from "@/lib/errors";
import { MemberRole } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const rate = await checkDistributedRateLimit(req, {
      keyPrefix: "seller-export",
      limit: 15,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Seller export rate limit exceeded" },
        { status: 429, headers: rate.headers }
      );
    }

    const session = await getServerSession();
    if (!session?.user?.id || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401, headers: rate.headers }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
      MemberRole.MANAGER,
    ]);

    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "orders").toLowerCase() as SellerExportEntity;

    const result = await exportSellerTenantData(businessId, session.user.id, type);
    return NextResponse.json({ success: true, data: result }, { headers: rate.headers });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/seller/export" });
  }
}
