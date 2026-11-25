import { NextRequest, NextResponse } from "next/server";
import { processLogisticsWebhook } from "@/lib/commerce-webhooks";
import { checkRateLimit } from "@/lib/rate-limiter";
import { handleApiError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  try {
    const rate = checkRateLimit(req, {
      limit: 120,
      windowMs: 60 * 1000,
      keyPrefix: `wh_ship_${params.provider}`,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many webhook requests" },
        { status: 429, headers: rate.headers }
      );
    }

    const rawBody = await req.text();
    const signature =
      req.headers.get("x-webhook-signature") ||
      req.headers.get("x-carrier-signature") ||
      req.headers.get("x-api-hmac-sha256") ||
      req.headers.get("x-hub-signature-256");

    const result = await processLogisticsWebhook({
      provider: params.provider,
      rawBody,
      signature,
    });

    return NextResponse.json({ success: true, data: result }, { headers: rate.headers });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/webhooks/logistics/[provider]" });
  }
}
