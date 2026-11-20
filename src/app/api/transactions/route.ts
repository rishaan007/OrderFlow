import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { createSocialTransactionSchema } from "@/lib/validations";
import { createSocialTransaction } from "@/lib/transactions";
import { ApiResponse, SocialPlatform, SocialSurface, TransactionStatus } from "@/types";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const platform = (searchParams.get("platform") as SocialPlatform) || undefined;
    const surface = (searchParams.get("surface") as SocialSurface) || undefined;
    const status = (searchParams.get("status") as TransactionStatus) || undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: any = { businessId };
    if (platform) where.platform = platform;
    if (surface) where.surface = surface;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.socialTransaction.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              totalAmount: true,
              amountPaid: true,
              currency: true,
              status: true,
              paymentStatus: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              instagramHandle: true,
            },
          },
          _count: {
            select: {
              timelineEvents: true,
              evidence: true,
              disputes: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.socialTransaction.count({ where }),
    ]);

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          items,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await req.json();
    const validation = createSocialTransactionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: validation.error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const transaction = await createSocialTransaction(businessId, validation.data);

    return NextResponse.json<ApiResponse>(
      { success: true, data: transaction },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create transaction";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
