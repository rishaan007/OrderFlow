import { NextRequest } from "next/server";
import { DeliveryPartner, ShipmentStatus } from "@prisma/client";
import { getTenantDb } from "@/lib/tenant";
import { withDeveloperApi } from "@/lib/developer-platform";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/shipments", "shipments:read", async (ctx) => {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const orderId = searchParams.get("orderId") || undefined;
    const carrier = (searchParams.get("carrier") as DeliveryPartner) || undefined;
    const status = (searchParams.get("status") as ShipmentStatus) || undefined;
    const search = searchParams.get("search") || undefined;

    const tenantDb = getTenantDb(ctx.businessId);
    const result = await tenantDb.getShipments({
      orderId,
      carrier,
      status,
      search,
      isSandbox: ctx.isSandbox,
      page,
      limit,
    });

    return {
      status: 200,
      body: {
        success: true,
        environment: ctx.environment,
        data: result,
      },
    };
  });
}
