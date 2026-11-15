import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getTenantDb, TenantAccessError } from "@/lib/tenant";
import { createShipmentSchema } from "@/lib/validations";
import { DeliveryPartner, ShipmentStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId") || undefined;
    const carrier = searchParams.get("carrier") as DeliveryPartner | null;
    const status = searchParams.get("status") as ShipmentStatus | null;
    const search = searchParams.get("search") || undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 25;

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const result = await tenantDb.getShipments({
      orderId,
      carrier: carrier || undefined,
      status: status || undefined,
      search,
      page,
      limit,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("GET /api/shipments error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch shipments" },
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
        { success: false, error: "Missing orderId in shipment creation request" },
        { status: 400 }
      );
    }

    const validation = createShipmentSchema.safeParse(body);
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
    const shipment = await tenantDb.createShipment(orderId, validation.data);

    return NextResponse.json({ success: true, data: shipment }, { status: 201 });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("POST /api/shipments error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create shipment" },
      { status: 500 }
    );
  }
}
