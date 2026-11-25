import { NextRequest, NextResponse } from "next/server";
import { ApiEnvironment, IntegrationCategory, MemberRole } from "@prisma/client";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import {
  connectThirdPartyIntegration,
  disconnectThirdPartyIntegration,
  discoverIntegrationCapabilities,
  listIntegrationCatalog,
} from "@/lib/integrations-hub";
import { connectIntegrationSchema } from "@/lib/validations";
import { handleApiError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const { searchParams } = new URL(req.url);
    const connectionId = searchParams.get("connectionId");
    if (connectionId) {
      const capabilities = await discoverIntegrationCapabilities(businessId, connectionId);
      return NextResponse.json({ success: true, data: capabilities });
    }

    const category = (searchParams.get("category") as IntegrationCategory) || undefined;
    const catalog = await listIntegrationCatalog(businessId, category);
    return NextResponse.json({ success: true, data: catalog });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/integrations" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
      MemberRole.MANAGER,
    ]);

    const body = await req.json();
    const parsed = connectIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.errors[0]?.message || "Invalid integration payload",
        parsed.error.flatten()
      );
    }

    const connection = await connectThirdPartyIntegration(businessId, {
      ...parsed.data,
      environment: parsed.data.environment as ApiEnvironment,
    });

    return NextResponse.json({ success: true, data: connection }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/integrations" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated or no active business" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId, [MemberRole.OWNER, MemberRole.ADMIN]);

    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const connectionId = searchParams.get("connectionId") || body?.connectionId;
    if (!connectionId) {
      throw new ValidationError("connectionId is required");
    }

    const result = await disconnectThirdPartyIntegration(businessId, connectionId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return handleApiError(error, { action: "DELETE /api/integrations" });
  }
}
