import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getTenantDb, TenantAccessError, InventoryError } from "@/lib/tenant";
import { createOrderFromConversationSchema } from "@/lib/validations";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = createOrderFromConversationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);

    // Creates the order under the tenant with inventory check, stock deduction,
    // duplicate order prevention, and marks conversation as ORDER_CREATED.
    const order = await tenantDb.createOrderFromConversation(params.id, validation.data);

    return NextResponse.json({ success: true, data: order }, { status: 201 });
  } catch (error: any) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    if (error instanceof InventoryError) {
      return NextResponse.json(
        { success: false, error: error.message, isInventoryError: true },
        { status: 409 }
      );
    }
    if (error?.message?.includes("Duplicate order prevented")) {
      return NextResponse.json(
        { success: false, error: error.message, isDuplicate: true },
        { status: 409 }
      );
    }
    console.error("POST /api/conversations/[id]/create-order error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to create order from conversation" },
      { status: 500 }
    );
  }
}
