import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { reviewDisputeCaseSchema } from "@/lib/validations";
import { reviewDisputeCase } from "@/lib/disputes";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const body = await req.json().catch(() => ({}));
    const validation = reviewDisputeCaseSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || "Invalid review data" },
        { status: 400 }
      );
    }

    const updated = await reviewDisputeCase(
      params.id,
      businessId,
      session.user.id,
      validation.data.notes ?? undefined
    );

    return NextResponse.json({ success: true, data: updated });
  } catch (error: any) {
    const status = error.message?.includes("Access denied") || error.message?.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to review dispute" },
      { status }
    );
  }
}
