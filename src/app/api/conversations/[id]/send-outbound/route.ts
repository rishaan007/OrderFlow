import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { sendOutboundSocialMessage } from "@/lib/outbound-messaging";
import { z } from "zod";

const outboundSchema = z.object({
  messageType: z.enum([
    "TRANSACTION_LINK",
    "PAYMENT_REQUEST",
    "ORDER_CONFIRMATION",
    "SHIPMENT_UPDATE",
    "CUSTOM",
  ]),
  customText: z.string().optional(),
  transactionId: z.string().optional(),
  orderId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await request.json();
    const validated = outboundSchema.parse(body);

    const result = await sendOutboundSocialMessage({
      businessId,
      conversationId: params.id,
      ...validated,
    });

    return NextResponse.json({
      success: result.success,
      data: result,
      message: result.success
        ? `Message sent via ${result.platform}`
        : `Message recorded (status: ${result.status})`,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json(
        { success: false, error: error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: error.message || "Failed to dispatch message" },
      { status: 500 }
    );
  }
}
