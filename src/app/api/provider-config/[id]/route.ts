import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { handleApiError, NotFoundError } from "@/lib/errors";
import {
  getPaymentProviderConfigById,
  sanitizePaymentProviderConfig,
  upsertPaymentProviderConfig,
} from "@/lib/payment-provider";
import { MemberRole, ProviderHealthStatus } from "@prisma/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }
    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const config = await getPaymentProviderConfigById(businessId, params.id);
    if (!config) throw new NotFoundError("Provider config not found");

    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/provider-config/[id]" });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const existing = await prisma.paymentProviderConfig.findFirst({
      where: { id: params.id, businessId },
    });
    if (!existing) throw new NotFoundError("Provider config not found");

    const body = await req.json();
    const updated = await upsertPaymentProviderConfig(businessId, {
      provider: existing.provider,
      environment: (existing.environment as "sandbox" | "live") || "sandbox",
      enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled,
      accountIdentifier:
        body.accountIdentifier !== undefined
          ? body.accountIdentifier
          : existing.accountIdentifier,
      credentials: body.credentials ?? undefined,
      metadata: body.metadata ?? undefined,
    });

    if (typeof body.enabled === "boolean" && !body.enabled) {
      const disabled = await prisma.paymentProviderConfig.update({
        where: { id: existing.id },
        data: { status: ProviderHealthStatus.DISABLED },
      });
      return NextResponse.json({
        success: true,
        data: sanitizePaymentProviderConfig(disabled),
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return handleApiError(error, { action: "PATCH /api/provider-config/[id]" });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const existing = await prisma.paymentProviderConfig.findFirst({
      where: { id: params.id, businessId },
    });
    if (!existing) throw new NotFoundError("Provider config not found");

    await prisma.paymentProviderConfig.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    return handleApiError(error, { action: "DELETE /api/provider-config/[id]" });
  }
}
