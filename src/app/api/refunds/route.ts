import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { createRefundSchema } from "@/lib/validations";
import { getRefunds, requestRefund } from "@/lib/refunds";
import { RefundStatus, RefundType } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId") || undefined;
    const status = (searchParams.get("status") as RefundStatus) || undefined;
    const type = (searchParams.get("type") as RefundType) || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const data = await getRefunds(businessId, { orderId, status, type, page, limit });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/refunds" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await req.json();
    const validation = createRefundSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid refund payload",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const refund = await requestRefund(businessId, validation.data, session.user.id);
    return NextResponse.json({ success: true, data: refund }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/refunds" });
  }
}
