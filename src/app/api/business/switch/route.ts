import { NextRequest, NextResponse } from "next/server";
import { getServerSession, BUSINESS_COOKIE_NAME } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { ApiResponse } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    const { businessId } = await req.json();
    if (!businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "businessId is required" },
        { status: 400 }
      );
    }

    // Verify user is a member of this business
    const membership = await assertBusinessAccess(session.user.id, businessId);

    const response = NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          activeBusiness: {
            businessId: membership.business.id,
            businessName: membership.business.name,
            businessSlug: membership.business.slug,
            role: membership.role,
          },
        },
      },
      { status: 200 }
    );

    response.cookies.set(BUSINESS_COOKIE_NAME, businessId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
