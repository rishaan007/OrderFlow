import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { createReturnRequestSchema } from "@/lib/validations";
import { createReturnRequest, getReturns } from "@/lib/returns";
import { ReturnStatus } from "@prisma/client";

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
    const status = (searchParams.get("status") as ReturnStatus) || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const data = await getReturns(businessId, { orderId, status, page, limit });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/returns" });
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
    const validation = createReturnRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid return request payload",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const ret = await createReturnRequest(businessId, validation.data, {
      actorType: "SELLER",
      bypassPolicyWindow: validation.data.bypassPolicyWindow,
    });
    return NextResponse.json({ success: true, data: ret }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/returns" });
  }
}
