import { NextRequest, NextResponse } from "next/server";
import { MemberRole, TaxCalculationMode } from "@prisma/client";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import {
  calculateOrderTotalSnapshot,
  createTaxRule,
  listTaxRules,
} from "@/lib/tax";
import { createTaxRuleSchema } from "@/lib/validations";
import { handleApiError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
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

    const rules = await listTaxRules(businessId);
    return NextResponse.json({ success: true, data: rules });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/tax/rules" });
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
    const body = await req.json();

    if (body?.action === "PREVIEW") {
      await assertBusinessAccess(session.user.id, businessId);
      const snapshot = await calculateOrderTotalSnapshot({
        businessId,
        subtotalMinorUnits: Number(body.subtotalMinorUnits ?? 0),
        discountMinorUnits: Number(body.discountMinorUnits ?? 0),
        shippingMinorUnits: Number(body.shippingMinorUnits ?? 0),
        feesMinorUnits: Number(body.feesMinorUnits ?? 0),
        currency: String(body.currency || session.activeBusiness.currency || "USD"),
        countryCode: body.countryCode || null,
        stateCode: body.stateCode || null,
        category: body.category || null,
      });
      return NextResponse.json({ success: true, data: snapshot });
    }

    await assertBusinessAccess(session.user.id, businessId, [
      MemberRole.OWNER,
      MemberRole.ADMIN,
      MemberRole.MANAGER,
    ]);

    const parsed = createTaxRuleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.errors[0]?.message || "Invalid tax rule payload",
        parsed.error.flatten()
      );
    }

    const rule = await createTaxRule(businessId, {
      ...parsed.data,
      mode: parsed.data.mode as TaxCalculationMode,
    });

    return NextResponse.json({ success: true, data: rule }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/tax/rules" });
  }
}
