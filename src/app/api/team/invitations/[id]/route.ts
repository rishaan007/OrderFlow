import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { revokeInvitation } from "@/lib/team";
import { handleApiError } from "@/lib/errors";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "No active business workspace selected" }, { status: 404 });
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    await revokeInvitation(businessId, params.id, session.user.id);

    return NextResponse.json(
      {
        success: true,
        message: "Invitation successfully revoked",
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error, { action: "REVOKE_TEAM_INVITATION" });
  }
}
