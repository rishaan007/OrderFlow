import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";
import { getPublicTransactionByToken } from "@/lib/transactions";
import { ApiResponse } from "@/types";

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    // 1. Rate limiting check (e.g. 60 requests per minute per IP for public endpoints)
    const rateLimit = checkRateLimit(req, { limit: 60, windowMs: 60 * 1000, keyPrefix: "public_tx" });
    if (!rateLimit.allowed) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Too many requests. Please try again later." },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const { token } = params;
    if (!token || token.length < 8) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Invalid tracking token" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    // 2. Fetch sanitized, buyer-safe projection
    const transaction = await getPublicTransactionByToken(token);

    if (!transaction) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Transaction room not found or link has expired" },
        { status: 404, headers: rateLimit.headers }
      );
    }

    return NextResponse.json<ApiResponse>(
      { success: true, data: transaction },
      { status: 200, headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error loading transaction";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
