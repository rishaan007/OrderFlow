import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import {
  getBusinessConnections,
  createOrUpdateConnection,
} from "@/lib/connections";
import { getPlatformsCapabilityMatrix } from "@/lib/providers/registry";
import { SocialPlatform } from "@prisma/client";
import { z } from "zod";

const connectSchema = z.object({
  platform: z.nativeEnum(SocialPlatform),
  accountIdentifier: z.string().min(1, "Account identifier is required"),
  accountName: z.string().optional(),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  webhookSecret: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const connections = await getBusinessConnections(businessId);
    const capabilities = getPlatformsCapabilityMatrix();

    return NextResponse.json({
      success: true,
      data: {
        connections,
        availablePlatforms: capabilities,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load connections" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await request.json();
    const validated = connectSchema.parse(body);

    const connection = await createOrUpdateConnection(businessId, {
      platform: validated.platform,
      accountIdentifier: validated.accountIdentifier,
      accountName: validated.accountName,
      avatarUrl: validated.avatarUrl || undefined,
      accessToken: validated.accessToken,
      refreshToken: validated.refreshToken,
      webhookSecret: validated.webhookSecret,
      metadata: validated.metadata,
    });

    return NextResponse.json(
      {
        success: true,
        data: connection,
        message: `${validated.platform} account successfully connected`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json(
        { success: false, error: error.errors[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: error.message || "Failed to connect platform" },
      { status: 500 }
    );
  }
}
