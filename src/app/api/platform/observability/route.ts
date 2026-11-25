import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { getPlatformObservabilitySnapshot } from "@/lib/platform-observability";
import { ForbiddenError, handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const scope = (searchParams.get("scope") || "tenant").toLowerCase();
    const windowDays = Math.min(365, Math.max(1, parseInt(searchParams.get("days") || "30", 10) || 30));

    if (scope === "platform") {
      if (session.user.systemRole !== "ADMIN" && session.user.systemRole !== "SUPER_ADMIN") {
        throw new ForbiddenError("Platform-wide observability requires administrator privileges");
      }
      const snapshot = await getPlatformObservabilitySnapshot({ windowDays });
      return NextResponse.json({ success: true, data: snapshot });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "No active business workspace selected" },
        { status: 400 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const snapshot = await getPlatformObservabilitySnapshot({
      businessId,
      windowDays,
    });
    return NextResponse.json({ success: true, data: snapshot });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/platform/observability" });
  }
}
