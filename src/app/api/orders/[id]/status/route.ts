import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess, getTenantDb, InventoryError } from "@/lib/tenant";
import { updateOrderStatusSchema } from "@/lib/validations";
import { ApiResponse } from "@/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const parseResult = updateOrderStatusSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid status",
        },
        { status: 400 }
      );
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const updated = await tenantDb.updateOrder(params.id, {
      status: parseResult.data.status,
    });

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: updated,
      },
      { status: 200 }
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
