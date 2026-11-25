import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { resolveDisputeCaseSchema } from "@/lib/validations";
import { resolveDisputeCase } from "@/lib/disputes";

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

    const body = await req.json();
    const validation = resolveDisputeCaseSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || "Invalid resolution data" },
        { status: 400 }
      );
    }

    const resolved = await resolveDisputeCase(
      params.id,
      businessId,
      validation.data as any,
      session.user.id
    );

    return NextResponse.json({ success: true, data: resolved });
  } catch (error: any) {
    const status = error.message?.includes("Access denied") || error.message?.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to resolve dispute" },
      { status }
    );
  }
}
