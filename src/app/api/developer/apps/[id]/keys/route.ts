import { NextRequest, NextResponse } from "next/server";
import { ApiKeyType } from "@prisma/client";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateApiKey, revokeApiKey, rotateApiKey } from "@/lib/developer-platform";
import { createApiKeySchema } from "@/lib/validations";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = createApiKeySchema.safeParse({
      ...body,
      applicationId: params.id,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid API key input" },
        { status: 400 }
      );
    }

    const created = await generateApiKey(session.user.id, {
      applicationId: params.id,
      name: parsed.data.name,
      keyType: parsed.data.keyType as ApiKeyType,
      scopes: parsed.data.scopes,
      expiresInDays: parsed.data.expiresInDays,
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/developer/apps/[id]/keys" });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json();
    const apiKeyId = body?.apiKeyId as string | undefined;
    if (!apiKeyId) {
      throw new ValidationError("apiKeyId is required");
    }

    const belongs = await prisma.apiKey.findFirst({
      where: { id: apiKeyId, applicationId: params.id },
      select: { id: true },
    });
    if (!belongs) {
      throw new NotFoundError("API key not found in this application");
    }

    const rotated = await rotateApiKey(session.user.id, apiKeyId);
    return NextResponse.json({ success: true, data: rotated });
  } catch (error) {
    return handleApiError(error, { action: "PATCH /api/developer/apps/[id]/keys" });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const apiKeyId = searchParams.get("keyId") || body?.apiKeyId;
    if (!apiKeyId) {
      throw new ValidationError("keyId is required");
    }

    const belongs = await prisma.apiKey.findFirst({
      where: { id: apiKeyId, applicationId: params.id },
      select: { id: true },
    });
    if (!belongs) {
      throw new NotFoundError("API key not found in this application");
    }

    const revoked = await revokeApiKey(session.user.id, apiKeyId);
    return NextResponse.json({ success: true, data: revoked });
  } catch (error) {
    return handleApiError(error, { action: "DELETE /api/developer/apps/[id]/keys" });
  }
}
