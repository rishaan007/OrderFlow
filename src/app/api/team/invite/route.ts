import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { inviteTeamMember } from "@/lib/team";
import { MemberRole } from "@prisma/client";
import { handleApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
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
    const { email, role } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ success: false, error: "A valid email address is required" }, { status: 400 });
    }

    const memberRole = role ? (role as MemberRole) : MemberRole.STAFF;
    if (!Object.values(MemberRole).includes(memberRole)) {
      return NextResponse.json({ success: false, error: "Invalid role specified" }, { status: 400 });
    }

    const invite = await inviteTeamMember(businessId, session.user.id, email, memberRole);

    return NextResponse.json(
      {
        success: true,
        message: `Invitation successfully sent to ${email}`,
        data: invite,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, { action: "INVITE_TEAM_MEMBER" });
  }
}
