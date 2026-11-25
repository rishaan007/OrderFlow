import { NextRequest } from "next/server";
import { ProductStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantDb } from "@/lib/tenant";
import { withDeveloperApi } from "@/lib/developer-platform";
import { createProductSchema } from "@/lib/validations";
import { ForbiddenError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/products", "products:read", async (ctx) => {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const search = searchParams.get("search") || undefined;
    const category = searchParams.get("category") || undefined;
    const status = (searchParams.get("status") as ProductStatus) || undefined;
    const lowStockOnly = searchParams.get("lowStock") === "true";

    const tenantDb = getTenantDb(ctx.businessId);
    const result = await tenantDb.getProducts({
      search,
      category,
      status,
      lowStockOnly,
      page,
      limit,
    });

    return {
      status: 200,
      body: {
        success: true,
        environment: ctx.environment,
        data: result,
      },
    };
  });
}

export async function POST(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/products", "products:write", async (ctx) => {
    if (ctx.isSandbox) {
      const business = await prisma.business.findUnique({
        where: { id: ctx.businessId },
        select: { isSandboxBusiness: true },
      });
      if (!business?.isSandboxBusiness) {
        throw new ForbiddenError(
          "Sandbox API keys cannot mutate live product catalogs; use a LIVE key or sandbox workspace"
        );
      }
    }

    const body = await req.json();
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.errors[0]?.message || "Invalid product payload",
        parsed.error.flatten()
      );
    }

    const tenantDb = getTenantDb(ctx.businessId);
    const product = await tenantDb.createProduct(parsed.data);

    return {
      status: 201,
      body: {
        success: true,
        environment: ctx.environment,
        data: product,
      },
    };
  });
}
