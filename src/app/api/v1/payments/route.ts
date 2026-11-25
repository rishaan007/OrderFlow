import { NextRequest } from "next/server";
import { PaymentMethod, PaymentRecordStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantDb } from "@/lib/tenant";
import { withDeveloperApi } from "@/lib/developer-platform";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/payments", "payments:read", async (ctx) => {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const orderId = searchParams.get("orderId") || undefined;
    const status = (searchParams.get("status") as PaymentRecordStatus) || undefined;
    const method = (searchParams.get("method") as PaymentMethod) || undefined;
    const skip = (page - 1) * limit;

    const tenantDb = getTenantDb(ctx.businessId);
    const [payments, intents] = await Promise.all([
      tenantDb.getPayments({
        orderId,
        status,
        method,
        isSandbox: ctx.isSandbox,
        page,
        limit,
      }),
      prisma.paymentIntent.findMany({
        where: {
          businessId: ctx.businessId,
          isSandbox: ctx.isSandbox,
          ...(orderId ? { orderId } : {}),
        },
        select: {
          id: true,
          orderId: true,
          provider: true,
          status: true,
          amountMinorUnits: true,
          capturedMinorUnits: true,
          refundedMinorUnits: true,
          currency: true,
          isSandbox: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      status: 200,
      body: {
        success: true,
        environment: ctx.environment,
        data: {
          items: payments.items,
          paymentIntents: intents,
          pagination: payments.pagination,
        },
      },
    };
  });
}
