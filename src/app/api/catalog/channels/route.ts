import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { upsertChannelListingSchema } from "@/lib/validations";
import { getSocialProvider } from "@/lib/providers/registry";
import { ApiResponse } from "@/types";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId") || undefined;

    const listings = await prisma.productChannelListing.findMany({
      where: {
        businessId,
        ...(productId ? { productId } : {}),
      },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            price: true,
            stockQuantity: true,
            status: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json<ApiResponse>(
      { success: true, data: listings },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load channel listings";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await req.json();
    const validation = upsertChannelListingSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: validation.error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const data = validation.data;
    const product = await prisma.product.findFirst({
      where: { id: data.productId, businessId },
    });

    if (!product) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Product not found in this business" },
        { status: 404 }
      );
    }

    // Attempt provider catalog sync
    const provider = getSocialProvider(data.platform);
    const syncResult = await provider.syncProductCatalog(
      {
        id: product.id,
        title: product.title,
        price: Number(product.price),
        description: product.description,
        stockQuantity: product.stockQuantity,
      },
      "UPSERT"
    );

    const listing = await prisma.productChannelListing.upsert({
      where: {
        productId_platform: {
          productId: data.productId,
          platform: data.platform,
        },
      },
      create: {
        businessId,
        productId: data.productId,
        platform: data.platform,
        externalListingId: syncResult.externalListingId || data.externalListingId || null,
        platformTitle: data.platformTitle || product.title,
        platformPrice: data.platformPrice ? new Prisma.Decimal(data.platformPrice) : product.price,
        syncStatus: syncResult.status,
        syncError: syncResult.error || null,
        lastSyncAt: new Date(),
      },
      update: {
        externalListingId: syncResult.externalListingId || data.externalListingId || undefined,
        platformTitle: data.platformTitle || undefined,
        platformPrice: data.platformPrice ? new Prisma.Decimal(data.platformPrice) : undefined,
        syncStatus: syncResult.status,
        syncError: syncResult.error || null,
        lastSyncAt: new Date(),
      },
    });

    return NextResponse.json<ApiResponse>(
      { success: true, data: listing },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync operation failed";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
