import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { getDisputeById } from "@/lib/disputes";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }

    const dispute = await getDisputeById(params.id);
    if (!dispute) {
      return NextResponse.json({ success: false, error: "Dispute not found" }, { status: 404 });
    }

    // Check authorization: seller tenant or linked buyer identity
    let isSeller = false;
    let isAuthorized = false;

    if (session.activeBusiness?.businessId && session.activeBusiness.businessId === dispute.businessId) {
      try {
        await assertBusinessAccess(session.user.id, dispute.businessId);
        isSeller = true;
        isAuthorized = true;
      } catch {
        // not business member
      }
    }

    if (!isAuthorized) {
      const isBuyerUser = dispute.transaction?.buyerIdentity?.userId === session.user.id;
      const isDirectClaimant = dispute.claimantType === "BUYER" && dispute.claimantId === session.user.id;
      if (isBuyerUser || isDirectClaimant) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }

    if (!isSeller) {
      return NextResponse.json({
        success: true,
        data: {
          ...dispute,
          resolutionNotes: null,
          trustSignals: [],
          transaction: dispute.transaction
            ? {
                ...dispute.transaction,
                sellerNotes: null,
                order: dispute.transaction.order
                  ? { ...dispute.transaction.order, notes: null }
                  : null,
                customer: dispute.transaction.customer
                  ? { ...dispute.transaction.customer, notes: null }
                  : null,
              }
            : null,
        },
      });
    }

    return NextResponse.json({ success: true, data: dispute });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to retrieve dispute" },
      { status: 500 }
    );
  }
}
