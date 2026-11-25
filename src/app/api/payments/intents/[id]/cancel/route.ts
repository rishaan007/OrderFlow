import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { cancelPaymentIntent } from "@/lib/payment-intents";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await req.json().catch(() => ({}));
    const updated = await cancelPaymentIntent(
      businessId,
      params.id,
      typeof body?.reason === "string" ? body.reason : undefined,
      session.user.id
    );
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/payments/intents/[id]/cancel" });
  }
}
