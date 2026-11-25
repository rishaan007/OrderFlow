import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { getLedgerEntries, validateLedgerInvariants } from "@/lib/ledger";
import { LedgerEntryType } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId") || undefined;

    if (searchParams.get("validate") === "true") {
      const invariantCheck = await validateLedgerInvariants(businessId, orderId);
      return NextResponse.json({ success: true, data: invariantCheck });
    }

    const paymentIntentId = searchParams.get("paymentIntentId") || undefined;
    const refundId = searchParams.get("refundId") || undefined;
    const entryType = (searchParams.get("entryType") as LedgerEntryType) || undefined;
    const account = searchParams.get("account") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const data = await getLedgerEntries(businessId, {
      orderId,
      paymentIntentId,
      refundId,
      entryType,
      account,
      page,
      limit,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/ledger" });
  }
}
