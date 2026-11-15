import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getTenantDb, TenantAccessError } from "@/lib/tenant";
import { extractOrderSchema } from "@/lib/validations";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    let textOverride: string | undefined;
    try {
      const body = await request.json();
      const validation = extractOrderSchema.safeParse(body);
      if (validation.success && validation.data.textOverride) {
        textOverride = validation.data.textOverride;
      }
    } catch {
      // Body is optional
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const extracted = await tenantDb.extractOrderFromConversation(params.id, textOverride);

    return NextResponse.json({ success: true, data: extracted });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("POST /api/conversations/[id]/extract-order error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to extract order details from conversation" },
      { status: 500 }
    );
  }
}
