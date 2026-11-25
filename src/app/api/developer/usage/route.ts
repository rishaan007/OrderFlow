import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getDeveloperUsageMetrics } from "@/lib/developer-platform";
import { handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const applicationId = searchParams.get("applicationId") || undefined;

    const metrics = await getDeveloperUsageMetrics(session.user.id, applicationId);
    return NextResponse.json({ success: true, data: metrics });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/developer/usage" });
  }
}
