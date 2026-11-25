import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createWebhookSubscription,
  getOrCreateDeveloper,
  retryWebhookDelivery,
} from "@/lib/developer-platform";
import { createDeveloperWebhookSchema } from "@/lib/validations";
import { handleApiError, NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const developer = await getOrCreateDeveloper(session.user.id);
    const app = await prisma.developerApplication.findFirst({
      where: { id: params.id, developerId: developer.id },
    });
    if (!app) {
      throw new NotFoundError("Developer application not found");
    }

    const { searchParams } = new URL(req.url);
    const subscriptionId = searchParams.get("subscriptionId") || undefined;

    const [subscriptions, deliveries] = await Promise.all([
      prisma.webhookSubscription.findMany({
        where: { applicationId: app.id },
        select: {
          id: true,
          applicationId: true,
          businessId: true,
          targetUrl: true,
          description: true,
          eventTypes: true,
          environment: true,
          status: true,
          failureCount: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.webhookDelivery.findMany({
        where: {
          subscription: { applicationId: app.id },
          ...(subscriptionId ? { subscriptionId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: { subscriptions, deliveries },
    });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/developer/apps/[id]/webhooks" });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const developer = await getOrCreateDeveloper(session.user.id);
    const app = await prisma.developerApplication.findFirst({
      where: { id: params.id, developerId: developer.id },
    });
    if (!app) {
      throw new NotFoundError("Developer application not found");
    }

    const body = await req.json();

    if (body?.action === "RETRY" && body?.deliveryId) {
      const delivery = await prisma.webhookDelivery.findFirst({
        where: { id: body.deliveryId, subscription: { applicationId: app.id } },
      });
      if (!delivery) {
        throw new NotFoundError("Webhook delivery not found for this application");
      }
      const retried = await retryWebhookDelivery(delivery.id);
      return NextResponse.json({ success: true, data: retried });
    }

    const parsed = createDeveloperWebhookSchema.safeParse({
      ...body,
      applicationId: app.id,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid webhook subscription" },
        { status: 400 }
      );
    }

    const created = await createWebhookSubscription(session.user.id, {
      applicationId: app.id,
      targetUrl: parsed.data.targetUrl,
      description: parsed.data.description,
      eventTypes: parsed.data.eventTypes,
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/developer/apps/[id]/webhooks" });
  }
}
