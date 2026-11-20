import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { checkConnectionHealth } from "@/lib/connections";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const health = await checkConnectionHealth(businessId, params.id);

    return NextResponse.json({
      success: true,
      data: health,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to check connection health" },
      { status: 500 }
    );
  }
}
