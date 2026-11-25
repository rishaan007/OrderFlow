import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { getOrCreateBuyerIdentity } from "@/lib/buyer-identity";
import { getTrustSignals } from "@/lib/trust-signals";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: "buyer-trust-signals-get" });
  if (!rate.allowed) {
    return new Response("Too Many Requests", { status: 429, headers: rate.headers });
  }

  try {
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("activeOnly") !== "false";

    const identity = await getOrCreateBuyerIdentity(session.user.id);
    const signals = await getTrustSignals({
      buyerIdentityId: identity.id,
      activeOnly,
    });

    return NextResponse.json({ success: true, data: signals }, { headers: rate.headers });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to retrieve trust signals" },
      { status: 500, headers: rate.headers }
    );
  }
}
