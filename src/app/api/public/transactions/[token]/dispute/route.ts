import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";
import { createDisputeSchema } from "@/lib/validations";
import { createPublicDispute } from "@/lib/transactions";
import { ApiResponse } from "@/types";

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    // 1. Strict rate limiting for disputes (10 submissions per 15 minutes per IP)
    const rateLimit = checkRateLimit(req, { limit: 10, windowMs: 15 * 60 * 1000, keyPrefix: "public_dispute" });
    if (!rateLimit.allowed) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Too many dispute attempts. Please wait a few minutes." },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const { token } = params;
    const body = await req.json();
    const validation = createDisputeSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: validation.error.errors[0]?.message || "Invalid dispute details" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const dispute = await createPublicDispute(token, validation.data);

    return NextResponse.json<ApiResponse>(
      { success: true, data: dispute },
      { status: 201, headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record dispute";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
