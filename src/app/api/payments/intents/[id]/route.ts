import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { attemptPaymentIntentSchema } from "@/lib/validations";
import { attemptPaymentIntent, getPaymentIntentById } from "@/lib/payment-intents";

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

    const intent = await getPaymentIntentById(businessId, params.id);
    return NextResponse.json({ success: true, data: intent });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/payments/intents/[id]" });
  }
}

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

    const body = await req.json();
    const validation = attemptPaymentIntentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid attempt input",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const result = await attemptPaymentIntent(businessId, params.id, validation.data, session.user.id);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/payments/intents/[id]" });
  }
}
