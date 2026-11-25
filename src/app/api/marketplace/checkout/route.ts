import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getOrCreateBuyerIdentity } from "@/lib/buyer-identity";
import { executeMarketplaceCheckout } from "@/lib/marketplace";
import { marketplaceCheckoutSchema } from "@/lib/validations";
import { checkDistributedRateLimit } from "@/lib/rate-limiter";
import { handleApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const rate = await checkDistributedRateLimit(req, {
      keyPrefix: "marketplace-checkout",
      limit: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many checkout requests" },
        { status: 429, headers: rate.headers }
      );
    }

    const body = await req.json();
    const parsed = marketplaceCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid checkout input" },
        { status: 400, headers: rate.headers }
      );
    }

    // Optional authentication — preserves frictionless guest purchase philosophy
    const session = await getServerSession();
    let buyerUserId: string | null = null;
    let buyerIdentityId: string | null = null;
    if (session?.user?.id) {
      buyerUserId = session.user.id;
      const identity = await getOrCreateBuyerIdentity(session.user.id).catch(() => null);
      buyerIdentityId = identity?.id ?? null;
    }

    const result = await executeMarketplaceCheckout({
      ...parsed.data,
      buyerUserId,
      buyerIdentityId,
    });

    return NextResponse.json(
      { success: true, data: result },
      { status: 201, headers: rate.headers }
    );
  } catch (error) {
    return handleApiError(error, { action: "POST /api/marketplace/checkout" });
  }
}
