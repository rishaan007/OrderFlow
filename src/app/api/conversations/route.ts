import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getTenantDb, TenantAccessError } from "@/lib/tenant";
import { createConversationSchema } from "@/lib/validations";
import { ConversationChannel, ConversationStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const channel = searchParams.get("channel") as ConversationChannel | null;
    const status = searchParams.get("status") as ConversationStatus | null;
    const search = searchParams.get("search") || undefined;
    const customerId = searchParams.get("customerId") || undefined;
    const page = searchParams.get("page") ? parseInt(searchParams.get("page")!, 10) : 1;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 25;

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const result = await tenantDb.getConversations({
      channel: channel || undefined,
      status: status || undefined,
      search,
      customerId,
      page,
      limit,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("GET /api/conversations error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = createConversationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const conversation = await tenantDb.createConversation(validation.data);

    return NextResponse.json({ success: true, data: conversation }, { status: 201 });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("POST /api/conversations error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create conversation" },
      { status: 500 }
    );
  }
}
