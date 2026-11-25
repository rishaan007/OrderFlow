import { NextRequest, NextResponse } from "next/server";
import { searchMarketplaceProducts, searchMarketplaceSellers } from "@/lib/marketplace";
import { checkDistributedRateLimit } from "@/lib/rate-limiter";
import { handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const rate = await checkDistributedRateLimit(req, {
      keyPrefix: "marketplace-search",
      limit: 60,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Search rate limit exceeded" },
        { status: 429, headers: rate.headers }
      );
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || searchParams.get("query") || undefined;
    const type = (searchParams.get("type") || "products").toLowerCase();
    const category = searchParams.get("category") || undefined;
    const brand = searchParams.get("brand") || undefined;
    const sellerId = searchParams.get("sellerId") || undefined;
    const inStockOnly = searchParams.get("inStockOnly") === "true";
    const verifiedOnly = searchParams.get("verifiedOnly") === "true";
    const countryCode = searchParams.get("countryCode") || undefined;
    const city = searchParams.get("city") || undefined;
    const sortBy = (searchParams.get("sortBy") as any) || "RELEVANCE";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const minPriceParam = searchParams.get("minPriceMinorUnits");
    const maxPriceParam = searchParams.get("maxPriceMinorUnits");
    const minPriceMinorUnits = minPriceParam !== null ? parseInt(minPriceParam, 10) : undefined;
    const maxPriceMinorUnits = maxPriceParam !== null ? parseInt(maxPriceParam, 10) : undefined;

    if (type === "sellers") {
      const sellers = await searchMarketplaceSellers({
        query,
        category,
        verifiedOnly,
        countryCode,
        city,
        page,
        limit,
      });
      return NextResponse.json({ success: true, data: sellers }, { headers: rate.headers });
    }

    const [products, matchingSellers] = await Promise.all([
      searchMarketplaceProducts({
        query,
        category,
        brand,
        sellerId,
        inStockOnly,
        verifiedOnly,
        minPriceMinorUnits: Number.isFinite(minPriceMinorUnits) ? minPriceMinorUnits : undefined,
        maxPriceMinorUnits: Number.isFinite(maxPriceMinorUnits) ? maxPriceMinorUnits : undefined,
        countryCode,
        city,
        sortBy,
        page,
        limit,
      }),
      type === "all"
        ? searchMarketplaceSellers({ query, category, verifiedOnly, countryCode, city, page: 1, limit: 6 })
        : Promise.resolve(null),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: type === "all" ? { products, sellers: matchingSellers } : products,
      },
      { headers: rate.headers }
    );
  } catch (error) {
    return handleApiError(error, { action: "GET /api/marketplace/search" });
  }
}
