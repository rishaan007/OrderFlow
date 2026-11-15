import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess, getTenantDb, InventoryError } from "@/lib/tenant";
import { createOrderSchema } from "@/lib/validations";
import { ApiResponse, OrderStatus, PaymentStatus, OrderSource } from "@/types";

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
    const status = (searchParams.get("status") as OrderStatus) || undefined;
    const paymentStatus = (searchParams.get("paymentStatus") as PaymentStatus) || undefined;
    const source = (searchParams.get("source") as OrderSource) || undefined;
    const customerId = searchParams.get("customerId") || undefined;
    const sortBy = (searchParams.get("sortBy") as any) || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || "desc";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    await assertBusinessAccess(session.user.id, session.activeBusiness.businessId);

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const result = await tenantDb.getOrders({
      search,
      status,
      paymentStatus,
      source,
      customerId,
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
    const parseResult = createOrderSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid order input",
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const order = await tenantDb.createOrder(parseResult.data);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: order,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (err instanceof InventoryError) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: err.message },
        { status: 422 }
      );
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
