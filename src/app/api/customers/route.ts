import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess, getTenantDb } from "@/lib/tenant";
import { createCustomerSchema } from "@/lib/validations";
import { ApiResponse } from "@/types";

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
    const tag = searchParams.get("tag") || undefined;
    const sortBy = (searchParams.get("sortBy") as any) || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || "desc";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    await assertBusinessAccess(session.user.id, session.activeBusiness.businessId);

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const result = await tenantDb.getCustomers({
      search,
      tag,
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
    const parseResult = createCustomerSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid customer data",
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const customer = await tenantDb.createCustomer(parseResult.data);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: customer,
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
