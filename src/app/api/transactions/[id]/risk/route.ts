import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { assessTransactionRisk } from "@/lib/risk-engine";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }

    const transaction = await prisma.socialTransaction.findUnique({
      where: { id: params.id },
      include: {
        buyerIdentity: true,
      },
    });

    if (!transaction) {
      return NextResponse.json({ success: false, error: "Transaction not found" }, { status: 404 });
    }

    // Authorization: User must either have access to the business tenant OR be the linked buyer
    let isAuthorized = false;

    if (session.activeBusiness?.businessId && session.activeBusiness.businessId === transaction.businessId) {
      try {
        await assertBusinessAccess(session.user.id, transaction.businessId);
        isAuthorized = true;
      } catch {
        isAuthorized = false;
      }
    }

    if (!isAuthorized && transaction.buyerIdentity?.userId === session.user.id) {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const force = searchParams.get("force") === "true";

    const assessment = await assessTransactionRisk(params.id, {
      forceReassessment: force,
      actorId: session.user.id,
    });

    return NextResponse.json({ success: true, data: assessment });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to assess transaction risk" },
      { status: 500 }
    );
  }
}
