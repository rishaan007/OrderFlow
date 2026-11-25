import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError, ValidationError } from "@/lib/errors";
import { resolveReconciliationEntrySchema } from "@/lib/validations";
import {
  getReconciliationRunById,
  resolveReconciliationEntry,
} from "@/lib/reconciliation";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const run = await getReconciliationRunById(businessId, params.id);
    return NextResponse.json({ success: true, data: run });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/reconciliation/[id]" });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await req.json();
    const entryId = body?.entryId;
    if (!entryId || typeof entryId !== "string") {
      throw new ValidationError("entryId is required to resolve a reconciliation discrepancy");
    }

    const validation = resolveReconciliationEntrySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid resolution payload",
        },
        { status: 400 }
      );
    }

    const updated = await resolveReconciliationEntry(
      businessId,
      entryId,
      validation.data.resolutionNotes,
      session.user.id
    );
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, { action: "PATCH /api/reconciliation/[id]" });
  }
}
