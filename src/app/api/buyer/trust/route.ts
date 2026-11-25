import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { getOrCreateBuyerIdentity } from "@/lib/buyer-identity";
import { getBuyerTrustProfile } from "@/lib/trust-profile";

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: "buyer-trust-get" });
  if (!rate.allowed) {
    return new Response("Too Many Requests", { status: 429, headers: rate.headers });
  }

  try {
    const identity = await getOrCreateBuyerIdentity(session.user.id);
    const profile = await getBuyerTrustProfile(identity.id);
    return NextResponse.json({ success: true, data: profile }, { headers: rate.headers });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to retrieve buyer trust profile" },
      { status: 500, headers: rate.headers }
    );
  }
}
