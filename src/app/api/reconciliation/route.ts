import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { runReconciliationSchema } from "@/lib/validations";
import {
  getReconciliationRuns,
  reconcilePayments,
  reconcileRefunds,
  reconcileShipments,
} from "@/lib/reconciliation";
import { ReconciliationType } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") as ReconciliationType) || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const data = await getReconciliationRuns(businessId, { type, page, limit });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/reconciliation" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await req.json();
    const validation = runReconciliationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid reconciliation request",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const opts = {
      provider: validation.data.provider,
      windowStart: validation.data.windowStart
        ? new Date(validation.data.windowStart)
        : undefined,
      windowEnd: validation.data.windowEnd ? new Date(validation.data.windowEnd) : undefined,
      providerRecords: validation.data.providerRecords,
    };

    let run;
    if (validation.data.type === "PAYMENT") {
      run = await reconcilePayments(businessId, opts);
    } else if (validation.data.type === "REFUND") {
      run = await reconcileRefunds(businessId, opts);
    } else {
      run = await reconcileShipments(businessId, opts);
    }

    return NextResponse.json({ success: true, data: run }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/reconciliation" });
  }
}
