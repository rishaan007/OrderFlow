import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getTenantDb, TenantAccessError } from "@/lib/tenant";
import { recordPaymentSchema } from "@/lib/validations";
import { PaymentMethod, PaymentRecordStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId") || undefined;
    const customerId = searchParams.get("customerId") || undefined;
    const status = searchParams.get("status") as PaymentRecordStatus | null;
    const method = searchParams.get("method") as PaymentMethod | null;
    const search = searchParams.get("search") || undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 25;

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const result = await tenantDb.getPayments({
      orderId,
      customerId,
      status: status || undefined,
      method: method || undefined,
      search,
      page,
      limit,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("GET /api/payments error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch payments" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const orderId = body.orderId;
    if (!orderId) {
      return NextResponse.json(
        { success: false, error: "Missing orderId in payment record request" },
        { status: 400 }
      );
    }

    const validation = recordPaymentSchema.safeParse(body);
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
    const payment = await tenantDb.recordPayment(
      orderId,
      validation.data,
      session.user.id
    );

    return NextResponse.json({ success: true, data: payment }, { status: 201 });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("POST /api/payments error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to record payment" },
      { status: 500 }
    );
  }
}
