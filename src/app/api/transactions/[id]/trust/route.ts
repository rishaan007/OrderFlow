import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { getSellerTrustProfile, getBuyerTrustProfileForSeller } from "@/lib/trust-profile";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();

    const transaction = await prisma.socialTransaction.findUnique({
      where: { id: params.id },
      include: {
        buyerIdentity: true,
      },
    });

    if (!transaction) {
      return NextResponse.json({ success: false, error: "Transaction not found" }, { status: 404 });
    }

    // Check authorization:
    // 1. Authenticated business member
    // 2. Authenticated buyer
    // 3. Or query param trackingToken matching publicTrackingToken
    const { searchParams } = new URL(req.url);
    const trackingToken = searchParams.get("token");

    let isAuthorized = false;
    if (trackingToken && trackingToken === transaction.publicTrackingToken) {
      isAuthorized = true;
    } else if (session?.user?.id) {
      if (session.activeBusiness?.businessId && session.activeBusiness.businessId === transaction.businessId) {
        try {
          await assertBusinessAccess(session.user.id, transaction.businessId);
          isAuthorized = true;
        } catch {
          // not business member
        }
      }
      if (!isAuthorized && transaction.buyerIdentity?.userId === session.user.id) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }

    const sellerProfile = await getSellerTrustProfile(transaction.businessId);

    let buyerTrustSummary = null;
    if (transaction.buyerIdentityId) {
      buyerTrustSummary = await getBuyerTrustProfileForSeller(
        transaction.businessId,
        transaction.buyerIdentityId
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        transactionId: transaction.id,
        seller: {
          businessId: transaction.businessId,
          businessName: sellerProfile.businessName,
          summary: sellerProfile.summary,
          modelVersion: sellerProfile.modelVersion,
        },
        buyer: buyerTrustSummary,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to retrieve transaction trust" },
      { status: 500 }
    );
  }
}
