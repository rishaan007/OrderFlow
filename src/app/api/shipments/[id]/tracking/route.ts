import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { createTrackingEventSchema } from "@/lib/validations";
import {
  generateShipmentLabel,
  getShipmentTrackingHistory,
  recordTrackingEvent,
} from "@/lib/shipping-provider";

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

    const history = await getShipmentTrackingHistory(businessId, params.id);
    return NextResponse.json({ success: true, data: history });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/shipments/[id]/tracking" });
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
    if (body?.action === "GENERATE_LABEL") {
      const label = await generateShipmentLabel(businessId, params.id);
      return NextResponse.json({ success: true, data: label }, { status: 201 });
    }

    const validation = createTrackingEventSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid tracking event input",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const res = await recordTrackingEvent(businessId, params.id, {
      ...validation.data,
      occurredAt: validation.data.occurredAt
        ? new Date(validation.data.occurredAt)
        : undefined,
    });
    return NextResponse.json({ success: true, data: res }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/shipments/[id]/tracking" });
  }
}
