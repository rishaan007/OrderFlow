import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { getBusinessInvitations } from "@/lib/team";
import { handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
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

    const invitations = await getBusinessInvitations(businessId);

    return NextResponse.json(
      {
        success: true,
        data: invitations,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error, { action: "GET_TEAM_INVITATIONS" });
  }
}
