import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { getRefundById, processRefund } from "@/lib/refunds";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const refund = await getRefundById(businessId, params.id);
    return NextResponse.json({ success: true, data: refund });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/refunds/[id]" });
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const refund = await processRefund(businessId, params.id, {
      actorUserId: session.user.id,
    });
    return NextResponse.json({ success: true, data: refund });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/refunds/[id]" });
  }
}
