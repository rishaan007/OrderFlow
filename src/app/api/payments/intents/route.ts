import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { createPaymentIntentSchema } from "@/lib/validations";
import { createPaymentIntent, getPaymentIntents } from "@/lib/payment-intents";
import { PaymentIntentStatus, PaymentProvider } from "@prisma/client";

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
    const status = (searchParams.get("status") as PaymentIntentStatus) || undefined;
    const provider = (searchParams.get("provider") as PaymentProvider) || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const data = await getPaymentIntents(businessId, { orderId, status, provider, page, limit });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/payments/intents" });
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
    const validation = createPaymentIntentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid payment intent input",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const intent = await createPaymentIntent(businessId, validation.data, session.user.id);
    return NextResponse.json({ success: true, data: intent }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/payments/intents" });
  }
}
