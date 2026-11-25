import { NextRequest } from "next/server";
import { SocialPlatform, SocialSurface, TransactionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withDeveloperApi } from "@/lib/developer-platform";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/transactions", "transactions:read", async (ctx) => {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const platform = (searchParams.get("platform") as SocialPlatform) || undefined;
    const surface = (searchParams.get("surface") as SocialSurface) || undefined;
    const status = (searchParams.get("status") as TransactionStatus) || undefined;
    const skip = (page - 1) * limit;

    const where = {
      businessId: ctx.businessId,
      isSandbox: ctx.isSandbox,
      ...(platform ? { platform } : {}),
      ...(surface ? { surface } : {}),
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.socialTransaction.findMany({
        where,
        select: {
          id: true,
          platform: true,
          surface: true,
          status: true,
          isSandbox: true,
          publicTrackingToken: true,
          orderId: true,
          customerId: true,
          createdAt: true,
          updatedAt: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              paymentStatus: true,
              totalAmount: true,
              currency: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.socialTransaction.count({ where }),
    ]);

    return {
      status: 200,
      body: {
        success: true,
        environment: ctx.environment,
        data: {
          items,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
          },
        },
      },
    };
  });
}
