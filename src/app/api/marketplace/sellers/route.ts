import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { searchMarketplaceSellers } from "@/lib/marketplace";
import { updateSellerNetworkProfile } from "@/lib/reputation";
import { updateSellerNetworkProfileSchema } from "@/lib/validations";
import { handleApiError } from "@/lib/errors";
import { MemberRole } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await searchMarketplaceSellers({
      query: searchParams.get("q") || undefined,
      category: searchParams.get("category") || undefined,
      verifiedOnly: searchParams.get("verifiedOnly") === "true",
      countryCode: searchParams.get("countryCode") || undefined,
      city: searchParams.get("city") || undefined,
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(searchParams.get("limit") || "20", 10),
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/marketplace/sellers" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
      MemberRole.MANAGER,
    ]);

    const body = await req.json();
    const parsed = updateSellerNetworkProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const updated = await updateSellerNetworkProfile(businessId, parsed.data);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, { action: "PATCH /api/marketplace/sellers" });
  }
}
