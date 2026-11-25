import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createWebhookSubscription, withDeveloperApi } from "@/lib/developer-platform";
import { createDeveloperWebhookSchema } from "@/lib/validations";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const v1WebhookInputSchema = createDeveloperWebhookSchema.omit({ applicationId: true });

export async function GET(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/webhooks", "webhooks:manage", async (ctx) => {
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: {
        applicationId: ctx.applicationId,
        businessId: ctx.businessId,
        environment: ctx.environment,
      },
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
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      status: 200,
      body: {
        success: true,
        environment: ctx.environment,
        data: subscriptions,
      },
    };
  });
}

export async function POST(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/webhooks", "webhooks:manage", async (ctx) => {
    const body = await req.json();
    const parsed = v1WebhookInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.errors[0]?.message || "Invalid webhook subscription payload",
        parsed.error.flatten()
      );
    }

    const app = await prisma.developerApplication.findUniqueOrThrow({
      where: { id: ctx.applicationId },
      include: { developer: { select: { userId: true } } },
    });

    const subscription = await createWebhookSubscription(app.developer.userId, {
      applicationId: ctx.applicationId,
      targetUrl: parsed.data.targetUrl,
      description: parsed.data.description,
      eventTypes: parsed.data.eventTypes,
    });

    return {
      status: 201,
      body: {
        success: true,
        environment: ctx.environment,
        data: subscription,
      },
    };
  });
}
