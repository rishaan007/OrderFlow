import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { getSocialCommerceAnalytics } from "@/lib/transactions";
import { ApiResponse } from "@/types";

export async function GET(_req: NextRequest) {
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

    const analytics = await getSocialCommerceAnalytics(businessId);

    return NextResponse.json<ApiResponse>(
      { success: true, data: analytics },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load social analytics";
    return NextResponse.json<ApiResponse>({ success: false, error: message }, { status: 500 });
  }
}
