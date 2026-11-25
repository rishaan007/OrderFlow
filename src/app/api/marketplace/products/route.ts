import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import {
  searchMarketplaceProducts,
  setProductMarketplaceVisibility,
} from "@/lib/marketplace";
import { getTransactionAwareRecommendations } from "@/lib/network-graph";
import { handleApiError } from "@/lib/errors";
import { z } from "zod";

const toggleProductVisibilitySchema = z.object({
  productId: z.string().uuid(),
  discoverable: z.boolean(),
  brand: z.string().max(100).optional().nullable(),
  category: z.string().max(100).optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("relatedToProductId");
    const category = searchParams.get("category") || undefined;

    if (productId) {
      const recs = await getTransactionAwareRecommendations({
        excludeProductId: productId,
        category,
        limit: 4,
      });
      return NextResponse.json({ success: true, data: recs });
    }

    const result = await searchMarketplaceProducts({
      query: searchParams.get("q") || undefined,
      category,
      brand: searchParams.get("brand") || undefined,
      sellerId: searchParams.get("sellerId") || undefined,
      inStockOnly: searchParams.get("inStockOnly") === "true",
      verifiedOnly: searchParams.get("verifiedOnly") === "true",
      page: parseInt(searchParams.get("page") || "1", 10),
      limit: parseInt(searchParams.get("limit") || "20", 10),
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/marketplace/products" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await req.json();
    const parsed = toggleProductVisibilitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }

    const updated = await setProductMarketplaceVisibility(
      businessId,
      parsed.data.productId,
      parsed.data.discoverable,
      {
        brand: parsed.data.brand,
        category: parsed.data.category,
        tags: parsed.data.tags,
      }
    );

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, { action: "PATCH /api/marketplace/products" });
  }
}
