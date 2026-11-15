import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess, getTenantDb } from "@/lib/tenant";
import { handleApiError, ForbiddenError } from "@/lib/errors";
import { MemberRole } from "@prisma/client";
import { hasMinimumRole } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "No active business workspace selected" }, { status: 404 });
    }

    const businessId = session.activeBusiness.businessId;
    const member = await assertBusinessAccess(session.user.id, businessId);

    // Only OWNER and ADMIN can view full audit logs
    if (!hasMinimumRole(member.role, MemberRole.ADMIN)) {
      throw new ForbiddenError("Only workspace Owners and Admins can view audit logs");
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const action = searchParams.get("action") || undefined;

    const tenantDb = getTenantDb(businessId);
    const result = await tenantDb.getAuditLogs({ page, limit, action });

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error, { action: "GET_AUDIT_LOGS" });
  }
}
