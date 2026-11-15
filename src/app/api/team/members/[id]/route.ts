import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { updateMemberRole, removeTeamMember } from "@/lib/team";
import { MemberRole } from "@prisma/client";
import { handleApiError } from "@/lib/errors";

export async function PATCH(
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

    const body = await req.json();
    const { role } = body;

    if (!role || !Object.values(MemberRole).includes(role as MemberRole)) {
      return NextResponse.json({ success: false, error: "Valid MemberRole is required" }, { status: 400 });
    }

    const updated = await updateMemberRole(businessId, params.id, role as MemberRole, session.user.id);

    return NextResponse.json(
      {
        success: true,
        message: "Team member role updated successfully",
        data: updated,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error, { action: "UPDATE_MEMBER_ROLE" });
  }
}

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

    await removeTeamMember(businessId, params.id, session.user.id);

    return NextResponse.json(
      {
        success: true,
        message: "Team member successfully removed from workspace",
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error, { action: "REMOVE_TEAM_MEMBER" });
  }
}
