import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError, ValidationError } from "@/lib/errors";
import { getOrderLedgerBalance } from "@/lib/ledger";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");
    if (!orderId) {
      throw new ValidationError("orderId query parameter is required");
    }

    const balance = await getOrderLedgerBalance(businessId, orderId);
    return NextResponse.json({ success: true, data: balance });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/ledger/balance" });
  }
}
