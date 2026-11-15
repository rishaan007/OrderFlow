import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getTenantDb, TenantAccessError } from "@/lib/tenant";
import { verifyPaymentSchema } from "@/lib/validations";

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
    const validation = verifyPaymentSchema.safeParse(body);
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
    const updatedPayment = await tenantDb.verifyPayment(
      params.id,
      validation.data,
      session.user.id
    );

    return NextResponse.json({ success: true, data: updatedPayment });
  } catch (error: any) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("POST /api/payments/[id]/verify error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to process payment verification" },
      { status: 500 }
    );
  }
}
