import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { updateDisputeSchema } from "@/lib/validations";
import { updateDisputeStatus } from "@/lib/transactions";
import { ApiResponse } from "@/types";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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
    const { disputeId, ...updateData } = body;

    if (!disputeId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "disputeId is required" },
        { status: 400 }
      );
    }

    const validation = updateDisputeSchema.safeParse(updateData);
    if (!validation.success) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: validation.error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const updated = await updateDisputeStatus(businessId, disputeId, validation.data);

    return NextResponse.json<ApiResponse>(
      { success: true, data: updated },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Dispute resolution failed";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
