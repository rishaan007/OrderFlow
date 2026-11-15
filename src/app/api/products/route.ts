import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess, getTenantDb } from "@/lib/tenant";
import { createProductSchema } from "@/lib/validations";
import { ApiResponse, ProductStatus } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const category = searchParams.get("category") || undefined;
    const status = (searchParams.get("status") as ProductStatus) || undefined;
    const lowStockOnly = searchParams.get("lowStock") === "true";
    const sortBy = (searchParams.get("sortBy") as any) || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || "desc";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    await assertBusinessAccess(session.user.id, session.activeBusiness.businessId);

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const result = await tenantDb.getProducts({
      search,
      category,
      status,
      lowStockOnly,
      sortBy,
      sortOrder,
      page,
      limit,
    });

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: result,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    await assertBusinessAccess(session.user.id, session.activeBusiness.businessId);

    const body = await req.json();
    const parseResult = createProductSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid product data",
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const product = await tenantDb.createProduct(parseResult.data);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: product,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
