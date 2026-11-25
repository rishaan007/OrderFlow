import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { DisputeStatus, DisputeCategory } from "@prisma/client";
import { createDisputeCaseSchema } from "@/lib/validations";
import { createDisputeCase, getBusinessDisputes } from "@/lib/disputes";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") as DisputeStatus) || undefined;
    const category = (searchParams.get("category") as DisputeCategory) || undefined;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const skip = (page - 1) * limit;

    const result = await getBusinessDisputes(businessId, {
      status,
      category,
      take: limit,
      skip,
    });

    return NextResponse.json({
      success: true,
      data: result.items,
      total: result.total,
      page,
      limit,
    });
  } catch (error: any) {
    const status = error.message?.includes("Access denied") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to list disputes" },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    const body = await req.json();

    const validation = createDisputeCaseSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || "Invalid dispute data" },
        { status: 400 }
      );
    }

    const transaction = await prisma.socialTransaction.findUnique({
      where: { id: validation.data.transactionId },
      include: {
        buyerIdentity: {
          select: { id: true, userId: true },
        },
      },
    });

    if (!transaction) {
      return NextResponse.json(
        { success: false, error: "Transaction not found" },
        { status: 404 }
      );
    }

    const isLinkedBuyer = transaction.buyerIdentity?.userId === session.user.id;
    let isSellerMember = false;

    if (!isLinkedBuyer) {
      try {
        await assertBusinessAccess(session.user.id, transaction.businessId);
        isSellerMember = true;
      } catch {
        isSellerMember = false;
      }
    }

    if (!isLinkedBuyer && !isSellerMember) {
      return NextResponse.json(
        { success: false, error: "Access denied" },
        { status: 403 }
      );
    }

    const dispute = await createDisputeCase(
      {
        transactionId: validation.data.transactionId,
        category: validation.data.category,
        reason: validation.data.reason,
        buyerNotes: validation.data.buyerNotes ?? undefined,
        refundAmount: validation.data.refundAmount ?? undefined,
        evidenceUrls: validation.data.evidenceUrls,
        mediaUrl: validation.data.mediaUrl ?? undefined,
        initialEvidenceNotes: validation.data.initialEvidenceNotes ?? undefined,
        businessId: transaction.businessId,
        orderId: transaction.orderId,
        claimantType: isLinkedBuyer ? "BUYER" : "SELLER",
        claimantId: isLinkedBuyer ? transaction.buyerIdentity?.id : session.user.id,
      },
      session.user.id
    );

    return NextResponse.json({ success: true, data: dispute }, { status: 201 });
  } catch (error: any) {
    const status = error.message?.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to create dispute case" },
      { status }
    );
  }
}
