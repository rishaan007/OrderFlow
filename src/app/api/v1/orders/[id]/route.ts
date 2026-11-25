import { NextRequest } from "next/server";
import { getTenantDb } from "@/lib/tenant";
import { withDeveloperApi } from "@/lib/developer-platform";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withDeveloperApi(req, "/api/v1/orders/[id]", "orders:read", async (ctx) => {
    const tenantDb = getTenantDb(ctx.businessId);
    const order = await tenantDb.getOrderById(params.id, {
      isSandbox: ctx.isSandbox,
    });

    if (!order) {
      throw new NotFoundError("Order not found in this tenant environment");
    }

    return {
      status: 200,
      body: {
        success: true,
        environment: ctx.environment,
        data: order,
      },
    };
  });
}
