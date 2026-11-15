import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess, getTenantDb } from "@/lib/tenant";
import { updateBusinessProfileSchema } from "@/lib/validations";
import { ApiResponse } from "@/types";
import { MemberRole } from "@prisma/client";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "No active business found" },
        { status: 404 }
      );
    }

    const membership = await assertBusinessAccess(
      session.user.id,
      session.activeBusiness.businessId
    );

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const business = await tenantDb.getBusiness();
    const members = await tenantDb.getMembers();

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          business,
          members,
          currentUserRole: membership.role,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "No active business found" },
        { status: 404 }
      );
    }

    // Role check: Only OWNER or ADMIN can edit business profile
    await assertBusinessAccess(
      session.user.id,
      session.activeBusiness.businessId,
      [MemberRole.OWNER, MemberRole.ADMIN]
    );

    const body = await req.json();
    const parseResult = updateBusinessProfileSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid update data",
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    await tenantDb.updateProfile(parseResult.data);

    const updated = await tenantDb.getBusiness();

    return NextResponse.json<ApiResponse>(
      {
        success: true,
        data: updated,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
