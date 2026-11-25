import { NextRequest, NextResponse } from "next/server";
import { ApiEnvironment } from "@prisma/client";
import { getServerSession } from "@/lib/auth";
import {
  API_SCOPES,
  createDeveloperApplication,
  DEVELOPER_WEBHOOK_EVENTS,
  listDeveloperApplications,
} from "@/lib/developer-platform";
import { createDeveloperAppSchema } from "@/lib/validations";
import { handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const result = await listDeveloperApplications(session.user.id);
    return NextResponse.json({
      success: true,
      data: {
        ...result,
        availableScopes: API_SCOPES,
        availableWebhookEvents: DEVELOPER_WEBHOOK_EVENTS,
      },
    });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/developer/apps" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = createDeveloperAppSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid developer app payload" },
        { status: 400 }
      );
    }

    const created = await createDeveloperApplication(session.user.id, {
      name: parsed.data.name,
      description: parsed.data.description,
      environment: parsed.data.environment as ApiEnvironment,
      businessId: parsed.data.businessId ?? session.activeBusiness?.businessId ?? null,
      allowedOrigins: parsed.data.allowedOrigins,
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/developer/apps" });
  }
}
