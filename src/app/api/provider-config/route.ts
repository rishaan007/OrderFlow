import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { handleApiError } from "@/lib/errors";
import { upsertPaymentProviderConfigSchema } from "@/lib/validations";
import {
  getPaymentProviderConfigs,
  upsertPaymentProviderConfig,
} from "@/lib/payment-provider";
import { MemberRole } from "@prisma/client";

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const configs = await getPaymentProviderConfigs(businessId);
    return NextResponse.json({ success: true, data: configs });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/provider-config" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
    ]);

    const body = await req.json();
    const validation = upsertPaymentProviderConfigSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid provider config payload",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const config = await upsertPaymentProviderConfig(businessId, validation.data);
    return NextResponse.json({ success: true, data: config }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/provider-config" });
  }
}
