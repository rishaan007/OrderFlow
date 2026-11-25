import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { exportBuyerPortabilityData } from "@/lib/export-portability";
import { checkDistributedRateLimit } from "@/lib/rate-limiter";
import { handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const rate = await checkDistributedRateLimit(req, {
      keyPrefix: "buyer-export",
      limit: 10,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Export rate limit exceeded" },
        { status: 429, headers: rate.headers }
      );
    }

    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401, headers: rate.headers }
      );
    }

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "JSON").toUpperCase() === "CSV" ? "CSV" : "JSON";

    const result = await exportBuyerPortabilityData(session.user.id, format);

    if (result.format === "CSV") {
      return new Response(result.csv, {
        status: 200,
        headers: {
          ...rate.headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="orderflow-buyer-export.csv"`,
          "X-Export-Checksum": result.checksum,
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        exportId: result.exportId,
        checksum: result.checksum,
        data: result.data,
      },
      { headers: rate.headers }
    );
  } catch (error) {
    return handleApiError(error, { action: "GET /api/buyer/export" });
  }
}
