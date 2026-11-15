import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { acceptInvitation } from "@/lib/team";
import { handleApiError } from "@/lib/errors";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Please log in or register before accepting an invitation" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { token } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ success: false, error: "Valid invitation token is required" }, { status: 400 });
    }

    const result = await acceptInvitation(token, session.user.id);

    return NextResponse.json(
      {
        success: true,
        message: "You have successfully joined the workspace",
        data: result,
      },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error, { action: "ACCEPT_TEAM_INVITATION" });
  }
}
