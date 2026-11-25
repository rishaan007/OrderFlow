import { NextRequest } from "next/server";
import { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withDeveloperApi } from "@/lib/developer-platform";
import { getPlatformObservabilitySnapshot } from "@/lib/platform-observability";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/analytics", "analytics:read", async (ctx) => {
    const { searchParams } = new URL(req.url);
    const windowDays = Math.min(365, Math.max(1, parseInt(searchParams.get("days") || "30", 10) || 30));

    if (ctx.isSandbox) {
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      const [orders, intentsCount, shipmentsCount] = await Promise.all([
        prisma.order.findMany({
          where: {
            businessId: ctx.businessId,
            isSandbox: true,
            createdAt: { gte: since },
          },
          select: { status: true, totalAmount: true },
        }),
        prisma.paymentIntent.count({
          where: { businessId: ctx.businessId, isSandbox: true, createdAt: { gte: since } },
        }),
        prisma.shipment.count({
          where: { businessId: ctx.businessId, isSandbox: true, createdAt: { gte: since } },
        }),
      ]);

      const active = orders.filter((o) => o.status !== OrderStatus.CANCELLED);
      const sandboxGmv = active.reduce((s, o) => s + Number(o.totalAmount), 0);

      return {
        status: 200,
        body: {
          success: true,
          environment: ctx.environment,
          data: {
            scope: `SANDBOX:${ctx.businessId}`,
            windowDays,
            sandboxOrdersCount: orders.length,
            sandboxGmvMajor: Math.round(sandboxGmv * 100) / 100,
            sandboxPaymentIntents: intentsCount,
            sandboxShipments: shipmentsCount,
          },
        },
      };
    }

    const snapshot = await getPlatformObservabilitySnapshot({
      businessId: ctx.businessId,
      windowDays,
    });

    return {
      status: 200,
      body: {
        success: true,
        environment: ctx.environment,
        data: snapshot,
      },
    };
  });
}
