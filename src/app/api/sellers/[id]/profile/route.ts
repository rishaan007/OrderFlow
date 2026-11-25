import { NextRequest, NextResponse } from "next/server";
import { getPublicSellerProfile } from "@/lib/reputation";
import { checkDistributedRateLimit } from "@/lib/rate-limiter";
import { handleApiError } from "@/lib/errors";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const rate = await checkDistributedRateLimit(req, {
      keyPrefix: "public-seller-profile",
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded" },
        { status: 429, headers: rate.headers }
      );
    }

    const profile = await getPublicSellerProfile(params.id);
    return NextResponse.json({ success: true, data: profile }, { headers: rate.headers });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/sellers/[id]/profile" });
  }
}
