import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { addEvidenceSchema } from "@/lib/validations";
import { addEvidence } from "@/lib/transactions";
import { ApiResponse } from "@/types";

export async function POST(
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
    const validation = addEvidenceSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: validation.error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const evidence = await addEvidence(businessId, params.id, validation.data);

    return NextResponse.json<ApiResponse>(
      { success: true, data: evidence },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to record evidence";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
