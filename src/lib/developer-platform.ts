import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  AccountLifecycleStatus,
  ApiEnvironment,
  ApiKeyStatus,
  ApiKeyType,
  Prisma,
  WebhookDeliveryStatus,
} from "@prisma/client";
import { prisma } from "./prisma";
import { encryptToken, decryptToken } from "./connections";
import { checkDistributedRateLimit } from "./rate-limiter";
import {
  AppError,
  DeveloperAuthError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ScopeForbiddenError,
  ValidationError,
  handleApiError,
} from "./errors";
import { enqueueBackgroundJob } from "./background-jobs";
import { logger } from "./logger";

export const API_SCOPES = [
  "orders:read",
  "orders:write",
  "products:read",
  "products:write",
  "customers:read",
  "transactions:read",
  "payments:read",
  "shipments:read",
  "webhooks:manage",
  "analytics:read",
  "marketplace:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const DEVELOPER_WEBHOOK_EVENTS = [
  "order.created",
  "order.updated",
  "payment.captured",
  "payment.failed",
  "shipment.created",
  "shipment.delivered",
  "return.requested",
  "refund.completed",
  "dispute.created",
  "buyer.identity.updated",
] as const;

export type DeveloperWebhookEventType = (typeof DEVELOPER_WEBHOOK_EVENTS)[number];

function hashApiKeySecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

function buildKeyPrefix(environment: ApiEnvironment, keyType: ApiKeyType): string {
  const envPart = environment === ApiEnvironment.LIVE ? "live" : "test";
  const typePart =
    keyType === ApiKeyType.PUBLIC
      ? "pk"
      : keyType === ApiKeyType.SERVER
        ? "srv"
        : "sk";
  return `of_${envPart}_${typePart}`;
}

export async function getOrCreateDeveloper(
  userId: string,
  defaults?: { organizationName?: string; contactEmail?: string; websiteUrl?: string }
) {
  const existing = await prisma.developer.findUnique({ where: { userId } });
  if (existing) return existing;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new NotFoundError("User not found");

  return prisma.developer.create({
    data: {
      userId,
      organizationName: defaults?.organizationName || user.name,
      contactEmail: defaults?.contactEmail || user.email,
      websiteUrl: defaults?.websiteUrl || null,
      status: AccountLifecycleStatus.ACTIVE,
    },
  });
}

export async function createDeveloperApplication(
  userId: string,
  input: {
    name: string;
    description?: string | null;
    environment?: ApiEnvironment;
    businessId?: string | null;
    allowedOrigins?: string[];
  }
) {
  const developer = await getOrCreateDeveloper(userId);

  if (input.businessId) {
    const member = await prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId: input.businessId, userId } },
    });
    if (!member) {
      throw new ForbiddenError("You do not have access to attach this business to a developer app");
    }
  }

  return prisma.developerApplication.create({
    data: {
      developerId: developer.id,
      businessId: input.businessId ?? null,
      name: input.name.trim(),
      description: input.description ?? null,
      environment: input.environment ?? ApiEnvironment.SANDBOX,
      allowedOrigins: input.allowedOrigins ?? [],
    },
  });
}

export async function listDeveloperApplications(userId: string) {
  const developer = await getOrCreateDeveloper(userId);
  const apps = await prisma.developerApplication.findMany({
    where: { developerId: developer.id },
    include: {
      apiKeys: {
        select: {
          id: true,
          name: true,
          keyType: true,
          environment: true,
          keyPrefix: true,
          scopes: true,
          status: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      webhooks: {
        select: {
          id: true,
          targetUrl: true,
          description: true,
          eventTypes: true,
          environment: true,
          status: true,
          failureCount: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return { developer, applications: apps };
}

/**
 * Generates a scoped API key. The plaintext secret is returned ONLY ONCE at creation.
 */
export async function generateApiKey(
  userId: string,
  input: {
    applicationId: string;
    name: string;
    keyType?: ApiKeyType;
    scopes: string[];
    expiresInDays?: number;
  }
) {
  const developer = await getOrCreateDeveloper(userId);
  const app = await prisma.developerApplication.findFirst({
    where: { id: input.applicationId, developerId: developer.id },
  });
  if (!app) {
    throw new NotFoundError("Developer application not found");
  }

  const invalidScopes = input.scopes.filter(
    (s) => !(API_SCOPES as readonly string[]).includes(s)
  );
  if (invalidScopes.length > 0) {
    throw new ValidationError(`Invalid API scope(s): ${invalidScopes.join(", ")}`);
  }

  const keyType = input.keyType ?? ApiKeyType.SERVER;
  // PUBLIC keys cannot carry write scopes
  if (keyType === ApiKeyType.PUBLIC && input.scopes.some((s) => s.endsWith(":write") || s === "webhooks:manage")) {
    throw new ValidationError("PUBLIC API keys may only be granted read-only scopes");
  }

  const prefixBase = buildKeyPrefix(app.environment, keyType);
  const randomSecret = crypto.randomBytes(24).toString("hex");
  const plaintextKey = `${prefixBase}_${randomSecret}`;
  const keyPrefix = plaintextKey.slice(0, 18);
  const keyHash = hashApiKeySecret(plaintextKey);

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const created = await prisma.apiKey.create({
    data: {
      applicationId: app.id,
      businessId: app.businessId,
      name: input.name.trim(),
      keyType,
      environment: app.environment,
      keyPrefix,
      keyHash,
      scopes: Array.from(new Set(input.scopes)),
      status: ApiKeyStatus.ACTIVE,
      expiresAt,
    },
  });

  return {
    id: created.id,
    name: created.name,
    keyType: created.keyType,
    environment: created.environment,
    keyPrefix: created.keyPrefix,
    scopes: created.scopes,
    status: created.status,
    expiresAt: created.expiresAt?.toISOString() ?? null,
    createdAt: created.createdAt.toISOString(),
    // Plaintext secret revealed once — callers must store it securely
    secretKey: plaintextKey,
  };
}

export async function rotateApiKey(userId: string, apiKeyId: string) {
  const developer = await getOrCreateDeveloper(userId);
  const existing = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, application: { developerId: developer.id } },
    include: { application: true },
  });
  if (!existing) throw new NotFoundError("API key not found");
  if (existing.status === ApiKeyStatus.REVOKED) {
    throw new ValidationError("Cannot rotate an already revoked API key");
  }

  const prefixBase = buildKeyPrefix(existing.environment, existing.keyType);
  const randomSecret = crypto.randomBytes(24).toString("hex");
  const plaintextKey = `${prefixBase}_${randomSecret}`;

  const [, newKey] = await prisma.$transaction([
    prisma.apiKey.update({
      where: { id: existing.id },
      data: { status: ApiKeyStatus.ROTATED, revokedAt: new Date() },
    }),
    prisma.apiKey.create({
      data: {
        applicationId: existing.applicationId,
        businessId: existing.businessId,
        name: existing.name,
        keyType: existing.keyType,
        environment: existing.environment,
        keyPrefix: plaintextKey.slice(0, 18),
        keyHash: hashApiKeySecret(plaintextKey),
        scopes: existing.scopes,
        status: ApiKeyStatus.ACTIVE,
        expiresAt: existing.expiresAt,
      },
    }),
  ]);

  return {
    rotatedKeyId: existing.id,
    newKeyId: newKey.id,
    keyPrefix: newKey.keyPrefix,
    scopes: newKey.scopes,
    environment: newKey.environment,
    secretKey: plaintextKey,
  };
}

export async function revokeApiKey(userId: string, apiKeyId: string) {
  const developer = await getOrCreateDeveloper(userId);
  const existing = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, application: { developerId: developer.id } },
  });
  if (!existing) throw new NotFoundError("API key not found");

  return prisma.apiKey.update({
    where: { id: existing.id },
    data: {
      status: ApiKeyStatus.REVOKED,
      revokedAt: new Date(),
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      status: true,
      revokedAt: true,
    },
  });
}

export interface AuthenticatedApiKeyContext {
  apiKeyId: string;
  applicationId: string;
  businessId: string;
  environment: ApiEnvironment;
  isSandbox: boolean;
  keyType: ApiKeyType;
  scopes: string[];
  rateLimitHeaders: Record<string, string>;
}

/**
 * Authenticates an inbound `/api/v1` request via API key, enforces scopes,
 * verifies active status, applies distributed rate limiting, and isolates Sandbox vs Live.
 */
export async function authenticateDeveloperApiKey(
  req: Request,
  requiredScope?: ApiScope
): Promise<AuthenticatedApiKeyContext> {
  const authHeader = req.headers.get("authorization") || "";
  const apiKeyHeader = req.headers.get("x-orderflow-api-key") || "";

  let rawKey = "";
  if (apiKeyHeader.trim()) {
    rawKey = apiKeyHeader.trim();
  } else if (authHeader.toLowerCase().startsWith("bearer ")) {
    rawKey = authHeader.slice(7).trim();
  }

  if (!rawKey || !rawKey.startsWith("of_")) {
    throw new DeveloperAuthError("Missing or malformed OrderFlow API key");
  }

  const keyHash = hashApiKeySecret(rawKey);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      application: {
        include: {
          developer: true,
        },
      },
    },
  });

  if (!apiKey || apiKey.status !== ApiKeyStatus.ACTIVE) {
    throw new DeveloperAuthError("API key is invalid, rotated, or revoked");
  }
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    throw new DeveloperAuthError("API key has expired");
  }
  if (
    apiKey.application.status !== AccountLifecycleStatus.ACTIVE ||
    apiKey.application.developer.status !== AccountLifecycleStatus.ACTIVE
  ) {
    throw new DeveloperAuthError("Developer application or account is suspended");
  }

  const businessId = apiKey.businessId || apiKey.application.businessId;
  if (!businessId) {
    throw new DeveloperAuthError("API key is not bound to an active business workspace");
  }

  if (requiredScope && !apiKey.scopes.includes(requiredScope)) {
    throw new ScopeForbiddenError(requiredScope);
  }

  const rateResult = await checkDistributedRateLimit(req, {
    keyPrefix: `dev-v1:${apiKey.applicationId}`,
    limit: apiKey.application.rateLimitPerMin || 120,
    windowMs: 60_000,
    identifierOverride: apiKey.id,
  });

  if (!rateResult.allowed) {
    throw new RateLimitError("Developer API rate limit exceeded");
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    apiKeyId: apiKey.id,
    applicationId: apiKey.applicationId,
    businessId,
    environment: apiKey.environment,
    isSandbox: apiKey.environment === ApiEnvironment.SANDBOX,
    keyType: apiKey.keyType,
    scopes: apiKey.scopes,
    rateLimitHeaders: rateResult.headers,
  };
}

export async function recordApiUsage(params: {
  ctx: AuthenticatedApiKeyContext;
  method: string;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
}) {
  await prisma.apiUsage.create({
    data: {
      applicationId: params.ctx.applicationId,
      apiKeyId: params.ctx.apiKeyId,
      businessId: params.ctx.businessId,
      method: params.method,
      endpoint: params.endpoint,
      statusCode: params.statusCode,
      latencyMs: Math.max(0, Math.round(params.latencyMs)),
      environment: params.ctx.environment,
    },
  });
}

export async function getDeveloperUsageMetrics(userId: string, applicationId?: string) {
  const developer = await getOrCreateDeveloper(userId);
  const apps = await prisma.developerApplication.findMany({
    where: {
      developerId: developer.id,
      ...(applicationId ? { id: applicationId } : {}),
    },
    select: { id: true },
  });
  const appIds = apps.map((a) => a.id);
  if (appIds.length === 0) {
    return { totalRequests: 0, errorRequests: 0, avgLatencyMs: 0, recentLogs: [] };
  }

  const [totalRequests, errorRequests, avgRes, recentLogs] = await Promise.all([
    prisma.apiUsage.count({ where: { applicationId: { in: appIds } } }),
    prisma.apiUsage.count({
      where: { applicationId: { in: appIds }, statusCode: { gte: 400 } },
    }),
    prisma.apiUsage.aggregate({
      where: { applicationId: { in: appIds } },
      _avg: { latencyMs: true },
    }),
    prisma.apiUsage.findMany({
      where: { applicationId: { in: appIds } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return {
    totalRequests,
    errorRequests,
    avgLatencyMs: Math.round(avgRes._avg.latencyMs || 0),
    recentLogs,
  };
}

// ------------------------------------------------------------------
// Outbound Developer Webhooks (Signed, Retried, Dead-Letter Safe)
// ------------------------------------------------------------------

export function signDeveloperWebhookPayload(
  rawBody: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const signedPayload = `${timestampSeconds}.${rawBody}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

export function verifyDeveloperWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranceSeconds: number = 300
): boolean {
  if (!header || !secret) return false;
  const parts = new Map<string, string>();
  for (const seg of header.split(",")) {
    const [k, v] = seg.split("=");
    if (k && v) parts.set(k.trim(), v.trim());
  }
  const tStr = parts.get("t");
  const v1 = parts.get("v1");
  if (!tStr || !v1) return false;

  const t = Number(tStr);
  if (!Number.isFinite(t)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - t) > toleranceSeconds) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`, "utf8")
    .digest("hex");

  const a = Buffer.from(v1.toLowerCase(), "utf8");
  const b = Buffer.from(expected.toLowerCase(), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function createWebhookSubscription(
  userId: string,
  input: {
    applicationId: string;
    targetUrl: string;
    description?: string | null;
    eventTypes: string[];
  }
) {
  const developer = await getOrCreateDeveloper(userId);
  const app = await prisma.developerApplication.findFirst({
    where: { id: input.applicationId, developerId: developer.id },
  });
  if (!app) throw new NotFoundError("Developer application not found");
  if (!app.businessId) {
    throw new ValidationError("Developer application must be linked to a business to subscribe to webhooks");
  }

  const invalidEvents = input.eventTypes.filter(
    (e) => !(DEVELOPER_WEBHOOK_EVENTS as readonly string[]).includes(e)
  );
  if (invalidEvents.length > 0) {
    throw new ValidationError(`Unsupported event type(s): ${invalidEvents.join(", ")}`);
  }

  const plaintextSecret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const encryptedSecret = encryptToken(plaintextSecret);

  const sub = await prisma.webhookSubscription.create({
    data: {
      applicationId: app.id,
      businessId: app.businessId,
      targetUrl: input.targetUrl,
      description: input.description ?? null,
      eventTypes: Array.from(new Set(input.eventTypes)),
      environment: app.environment,
      encryptedSecret,
      status: "ACTIVE",
    },
  });

  return {
    id: sub.id,
    applicationId: sub.applicationId,
    businessId: sub.businessId,
    targetUrl: sub.targetUrl,
    eventTypes: sub.eventTypes,
    environment: sub.environment,
    status: sub.status,
    signingSecret: plaintextSecret, // Shown once
    createdAt: sub.createdAt.toISOString(),
  };
}

export type WebhookTransportFn = (
  url: string,
  headers: Record<string, string>,
  body: string
) => Promise<{ status: number; body?: string }>;

const defaultWebhookTransport: WebhookTransportFn = async (url, headers, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, body: text.slice(0, 1000) };
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Enqueues and optionally attempts delivery for a normalized webhook event across matching subscriptions.
 */
export async function dispatchDeveloperWebhookEvent(
  params: {
    businessId: string;
    eventId?: string;
    eventType: DeveloperWebhookEventType;
    environment?: ApiEnvironment;
    data: Record<string, unknown>;
  },
  options?: { transport?: WebhookTransportFn; deliverImmediately?: boolean }
) {
  const env = params.environment ?? ApiEnvironment.LIVE;
  const eventId = params.eventId || `evt_${crypto.randomUUID().replace(/-/g, "")}`;

  const subscriptions = await prisma.webhookSubscription.findMany({
    where: {
      businessId: params.businessId,
      environment: env,
      status: "ACTIVE",
      eventTypes: { has: params.eventType },
    },
  });

  const envelope = {
    id: eventId,
    type: params.eventType,
    environment: env,
    businessId: params.businessId,
    createdAtUtc: new Date().toISOString(),
    data: params.data,
  };
  const rawBody = JSON.stringify(envelope);

  const deliveries = [];
  for (const sub of subscriptions) {
    const secret = decryptToken(sub.encryptedSecret);
    const signature = signDeveloperWebhookPayload(rawBody, secret);

    const existing = await prisma.webhookDelivery.findUnique({
      where: {
        subscriptionId_eventId: {
          subscriptionId: sub.id,
          eventId,
        },
      },
    });
    if (existing) {
      deliveries.push(existing);
      continue;
    }

    const created = await prisma.webhookDelivery.create({
      data: {
        subscriptionId: sub.id,
        businessId: params.businessId,
        eventId,
        eventType: params.eventType,
        payload: envelope as Prisma.InputJsonValue,
        signature,
        status: WebhookDeliveryStatus.PENDING,
        attemptCount: 0,
        maxAttempts: 5,
        attemptHistory: [],
      },
    });

    if (options?.deliverImmediately ?? true) {
      const delivered = await executeWebhookDelivery(
        created.id,
        options?.transport ?? defaultWebhookTransport
      );
      deliveries.push(delivered);
    } else {
      deliveries.push(created);
    }
  }

  return deliveries;
}

export async function executeWebhookDelivery(
  deliveryId: string,
  transport: WebhookTransportFn = defaultWebhookTransport
) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { subscription: true },
  });
  if (!delivery) throw new NotFoundError("Webhook delivery not found");

  if (delivery.subscription.status !== "ACTIVE") {
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: WebhookDeliveryStatus.DISABLED },
    });
  }

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: WebhookDeliveryStatus.DELIVERING },
  });

  const rawBody = JSON.stringify(delivery.payload);
  const secret = decryptToken(delivery.subscription.encryptedSecret);
  const signature = signDeveloperWebhookPayload(rawBody, secret);
  const attemptNum = delivery.attemptCount + 1;
  const now = new Date();
  const prevHistory = Array.isArray(delivery.attemptHistory) ? (delivery.attemptHistory as any[]) : [];

  try {
    const res = await transport(
      delivery.subscription.targetUrl,
      {
        "Content-Type": "application/json",
        "x-orderflow-event-id": delivery.eventId,
        "x-orderflow-event-type": delivery.eventType,
        "x-orderflow-signature": signature,
      },
      rawBody
    );

    const isSuccess = res.status >= 200 && res.status < 300;
    const historyEntry = {
      attempt: attemptNum,
      at: now.toISOString(),
      status: res.status,
      ok: isSuccess,
    };

    if (isSuccess) {
      await prisma.webhookSubscription.update({
        where: { id: delivery.subscriptionId },
        data: { failureCount: 0 },
      });

      return prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: WebhookDeliveryStatus.DELIVERED,
          signature,
          attemptCount: attemptNum,
          lastAttemptAt: now,
          deliveredAt: now,
          responseStatus: res.status,
          responseBody: res.body ?? null,
          errorMessage: null,
          attemptHistory: [...prevHistory, historyEntry] as Prisma.InputJsonValue,
        },
      });
    }

    return markDeliveryRetryOrDeadLetter(delivery, attemptNum, res.status, res.body, `HTTP ${res.status}`, [
      ...prevHistory,
      historyEntry,
    ]);
  } catch (err: any) {
    const historyEntry = {
      attempt: attemptNum,
      at: now.toISOString(),
      status: null,
      ok: false,
      error: err?.message || "Network timeout",
    };

    return markDeliveryRetryOrDeadLetter(
      delivery,
      attemptNum,
      null,
      null,
      err?.message || "Delivery failed",
      [...prevHistory, historyEntry]
    );
  }
}

async function markDeliveryRetryOrDeadLetter(
  delivery: any,
  attemptNum: number,
  responseStatus: number | null,
  responseBody: string | null | undefined,
  errorMessage: string,
  attemptHistory: any[]
) {
  const exhausted = attemptNum >= delivery.maxAttempts;
  const backoffSec = Math.min(3600, Math.pow(2, attemptNum) * 30);
  const nextRetryAt = exhausted ? null : new Date(Date.now() + backoffSec * 1000);
  const status = exhausted ? WebhookDeliveryStatus.FAILED : WebhookDeliveryStatus.RETRYING;

  const updated = await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status,
      attemptCount: attemptNum,
      lastAttemptAt: new Date(),
      nextRetryAt,
      responseStatus,
      responseBody: responseBody ?? null,
      errorMessage,
      attemptHistory: attemptHistory as Prisma.InputJsonValue,
    },
  });

  await prisma.webhookSubscription.update({
    where: { id: delivery.subscriptionId },
    data: { failureCount: { increment: 1 } },
  });

  if (!exhausted && nextRetryAt) {
    await enqueueBackgroundJob({
      businessId: delivery.businessId,
      jobType: "WEBHOOK_RETRY",
      payload: { deliveryId: delivery.id, attempt: attemptNum + 1 },
      idempotencyKey: `wh_retry:${delivery.id}:attempt_${attemptNum + 1}`,
      nextRunAt: nextRetryAt,
    }).catch((err) => {
      logger.warn("webhook_retry.enqueue_failed", { deliveryId: delivery.id, error: err?.message });
    });
  }

  return updated;
}

export async function retryWebhookDelivery(
  deliveryId: string,
  transport?: WebhookTransportFn
) {
  const existing = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!existing) throw new NotFoundError("Webhook delivery not found");

  if (existing.status === WebhookDeliveryStatus.FAILED) {
    // Allow manual retry from dead-letter state by bumping maxAttempts by 1
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.RETRYING,
        maxAttempts: existing.attemptCount + 1,
      },
    });
  }

  return executeWebhookDelivery(deliveryId, transport ?? defaultWebhookTransport);
}

export async function listWebhookDeliveries(userId: string, subscriptionId?: string) {
  const developer = await getOrCreateDeveloper(userId);
  const subs = await prisma.webhookSubscription.findMany({
    where: {
      application: { developerId: developer.id },
      ...(subscriptionId ? { id: subscriptionId } : {}),
    },
    select: { id: true },
  });
  const subIds = subs.map((s) => s.id);
  if (subIds.length === 0) return [];

  return prisma.webhookDelivery.findMany({
    where: { subscriptionId: { in: subIds } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/**
 * Shared Developer API v1 wrapper: enforces API key auth, required scope,
 * distributed rate limiting, latency/usage logging, and SANDBOX/LIVE response headers.
 */
export async function withDeveloperApi(
  req: Request,
  endpoint: string,
  requiredScope: ApiScope,
  handler: (ctx: AuthenticatedApiKeyContext) => Promise<{ status?: number; body: unknown }>
): Promise<NextResponse> {
  const start = Date.now();
  let ctx: AuthenticatedApiKeyContext | null = null;
  try {
    ctx = await authenticateDeveloperApiKey(req, requiredScope);
    const result = await handler(ctx);
    const statusCode = result.status ?? 200;

    await recordApiUsage({
      ctx,
      method: req.method,
      endpoint,
      statusCode,
      latencyMs: Date.now() - start,
    }).catch(() => {});

    return NextResponse.json(result.body, {
      status: statusCode,
      headers: {
        ...ctx.rateLimitHeaders,
        "X-OrderFlow-Environment": ctx.environment,
      },
    });
  } catch (error) {
    if (ctx) {
      const statusCode = error instanceof AppError ? error.statusCode : 500;
      await recordApiUsage({
        ctx,
        method: req.method,
        endpoint,
        statusCode,
        latencyMs: Date.now() - start,
      }).catch(() => {});
    }

    const resp = handleApiError(error, {
      action: `${req.method} ${endpoint}`,
      businessId: ctx?.businessId,
    });

    if (ctx) {
      for (const [k, v] of Object.entries(ctx.rateLimitHeaders)) {
        resp.headers.set(k, v);
      }
      resp.headers.set("X-OrderFlow-Environment", ctx.environment);
    }

    return resp;
  }
}
