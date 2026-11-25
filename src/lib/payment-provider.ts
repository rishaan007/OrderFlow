import crypto from "crypto";
import {
  PaymentMethod,
  PaymentProvider,
  ProviderHealthStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "./prisma";
import { encryptToken, decryptToken } from "./connections";
import { logger } from "./logger";
import { PaymentError, ValidationError } from "./errors";

export interface ProviderCredentials {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
  merchantId?: string;
  environment?: "sandbox" | "live";
}

export interface CreateProviderPaymentInput {
  orderId: string;
  orderNumber: string;
  amountMinorUnits: number;
  currency: string;
  idempotencyKey: string;
  description?: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateProviderPaymentResult {
  providerOrderId: string;
  status: "CREATED" | "PENDING" | "AUTHORIZED" | "CAPTURED";
  checkoutData?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface AuthorizeProviderPaymentInput {
  providerOrderId?: string | null;
  providerPaymentId?: string;
  amountMinorUnits: number;
  currency: string;
  method?: PaymentMethod;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface CaptureProviderPaymentInput {
  providerOrderId?: string | null;
  providerPaymentId?: string | null;
  amountMinorUnits: number;
  currency: string;
  idempotencyKey: string;
}

export interface RefundProviderPaymentInput {
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  amountMinorUnits: number;
  currency: string;
  reason: string;
  idempotencyKey: string;
}

export interface NormalizedPaymentWebhookEvent {
  providerEventId: string;
  eventType: string;
  occurredAt?: Date;
  accountIdentifier?: string;
  businessIdHint?: string;
  orderIdHint?: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  providerRefundId?: string;
  amountMinorUnits?: number;
  currency?: string;
  outcome:
    | "AUTHORIZED"
    | "CAPTURED"
    | "FAILED"
    | "REFUND_PROCESSING"
    | "REFUND_COMPLETED"
    | "REFUND_FAILED"
    | "IGNORED";
  failureCode?: string;
  failureReason?: string;
  raw: Record<string, unknown>;
}

export interface PaymentProviderAdapter {
  readonly provider: PaymentProvider;

  createPayment(
    input: CreateProviderPaymentInput,
    credentials?: ProviderCredentials | null
  ): Promise<CreateProviderPaymentResult>;

  authorizePayment(
    input: AuthorizeProviderPaymentInput,
    credentials?: ProviderCredentials | null
  ): Promise<{
    providerPaymentId: string;
    status: "AUTHORIZED" | "CAPTURED" | "FAILED";
    amountMinorUnits: number;
    failureCode?: string;
    failureReason?: string;
    raw: Record<string, unknown>;
  }>;

  capturePayment(
    input: CaptureProviderPaymentInput,
    credentials?: ProviderCredentials | null
  ): Promise<{
    providerPaymentId: string;
    status: "CAPTURED" | "FAILED";
    capturedMinorUnits: number;
    failureReason?: string;
    raw: Record<string, unknown>;
  }>;

  verifyPayment(
    input: {
      providerOrderId?: string | null;
      providerPaymentId?: string | null;
      signature?: string | null;
      expectedAmountMinorUnits?: number;
    },
    credentials?: ProviderCredentials | null
  ): Promise<{
    verified: boolean;
    status: "VERIFIED" | "FAILED" | "PENDING";
    raw: Record<string, unknown>;
  }>;

  cancelPayment(
    input: { providerOrderId?: string | null; providerPaymentId?: string | null; reason?: string },
    credentials?: ProviderCredentials | null
  ): Promise<{ cancelled: boolean; status: "CANCELLED"; raw: Record<string, unknown> }>;

  refundPayment(
    input: RefundProviderPaymentInput,
    credentials?: ProviderCredentials | null
  ): Promise<{
    providerRefundId: string;
    status: "PROCESSING" | "COMPLETED" | "FAILED";
    refundedMinorUnits: number;
    failureReason?: string;
    raw: Record<string, unknown>;
  }>;

  getPaymentStatus(
    input: { providerOrderId?: string | null; providerPaymentId?: string | null },
    credentials?: ProviderCredentials | null
  ): Promise<{
    status: string;
    capturedMinorUnits?: number;
    refundedMinorUnits?: number;
    currency?: string;
    raw: Record<string, unknown>;
  }>;

  verifyWebhookSignature(
    rawPayload: string,
    signature: string | null,
    secret?: string | null
  ): boolean;

  parseWebhookEvent(payload: unknown): NormalizedPaymentWebhookEvent | null;
}

function timingSafeHexCompare(a: string, b: string): boolean {
  const cleanA = a.trim().toLowerCase();
  const cleanB = b.trim().toLowerCase();
  if (cleanA.length !== cleanB.length || cleanA.length === 0) return false;
  return crypto.timingSafeEqual(Buffer.from(cleanA, "utf8"), Buffer.from(cleanB, "utf8"));
}

export class ManualPaymentAdapter implements PaymentProviderAdapter {
  readonly provider: PaymentProvider = PaymentProvider.MANUAL;

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentResult> {
    const providerOrderId = `man_ord_${crypto.createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 16)}`;
    return {
      providerOrderId,
      status: "PENDING",
      checkoutData: {
        mode: "MANUAL",
        instructions: "Collect payment via UPI, Bank Transfer, or Cash and submit/verify proof.",
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency,
      },
      raw: { providerOrderId, mode: "MANUAL" },
    };
  }

  async authorizePayment(input: AuthorizeProviderPaymentInput) {
    const providerPaymentId =
      input.providerPaymentId ||
      `man_pay_${crypto.createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 16)}`;
    return {
      providerPaymentId,
      status: "AUTHORIZED" as const,
      amountMinorUnits: input.amountMinorUnits,
      raw: { providerPaymentId, mode: "MANUAL" },
    };
  }

  async capturePayment(input: CaptureProviderPaymentInput) {
    const providerPaymentId =
      input.providerPaymentId ||
      `man_pay_${crypto.createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 16)}`;
    return {
      providerPaymentId,
      status: "CAPTURED" as const,
      capturedMinorUnits: input.amountMinorUnits,
      raw: { providerPaymentId, capturedMinorUnits: input.amountMinorUnits },
    };
  }

  async verifyPayment(input: {
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
  }) {
    return {
      verified: Boolean(input.providerPaymentId || input.providerOrderId),
      status: (input.providerPaymentId || input.providerOrderId ? "VERIFIED" : "PENDING") as
        | "VERIFIED"
        | "PENDING",
      raw: { manual: true },
    };
  }

  async cancelPayment(input: { providerOrderId?: string | null }) {
    return {
      cancelled: true,
      status: "CANCELLED" as const,
      raw: { providerOrderId: input.providerOrderId },
    };
  }

  async refundPayment(input: RefundProviderPaymentInput) {
    const providerRefundId = `man_ref_${crypto.createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 16)}`;
    return {
      providerRefundId,
      status: "COMPLETED" as const,
      refundedMinorUnits: input.amountMinorUnits,
      raw: { providerRefundId, reason: input.reason },
    };
  }

  async getPaymentStatus(input: { providerOrderId?: string | null; providerPaymentId?: string | null }) {
    return {
      status: "MANUAL_VERIFICATION_REQUIRED",
      raw: { ...input },
    };
  }

  verifyWebhookSignature(rawPayload: string, signature: string | null, secret?: string | null): boolean {
    if (!secret) return false;
    if (!signature) return false;
    const expected = crypto.createHmac("sha256", secret).update(rawPayload, "utf8").digest("hex");
    const provided = signature.replace(/^sha256=/, "");
    return timingSafeHexCompare(expected, provided);
  }

  parseWebhookEvent(payload: any): NormalizedPaymentWebhookEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const eventId = payload.eventId || payload.id;
    const eventType = payload.eventType || payload.event;
    if (!eventId || !eventType) return null;

    let outcome: NormalizedPaymentWebhookEvent["outcome"] = "IGNORED";
    if (eventType === "payment.captured") outcome = "CAPTURED";
    else if (eventType === "payment.authorized") outcome = "AUTHORIZED";
    else if (eventType === "payment.failed") outcome = "FAILED";
    else if (eventType === "refund.processed") outcome = "REFUND_COMPLETED";

    return {
      providerEventId: String(eventId),
      eventType: String(eventType),
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : undefined,
      businessIdHint: payload.businessId,
      orderIdHint: payload.orderId,
      providerOrderId: payload.providerOrderId,
      providerPaymentId: payload.providerPaymentId,
      providerRefundId: payload.providerRefundId,
      amountMinorUnits:
        typeof payload.amountMinorUnits === "number" ? payload.amountMinorUnits : undefined,
      currency: payload.currency,
      outcome,
      failureCode: payload.failureCode,
      failureReason: payload.failureReason,
      raw: payload,
    };
  }
}

export class RazorpayPaymentAdapter implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.RAZORPAY;

  async createPayment(
    input: CreateProviderPaymentInput,
    credentials?: ProviderCredentials | null
  ): Promise<CreateProviderPaymentResult> {
    if (credentials?.environment === "live" && (!credentials?.keyId || !credentials?.keySecret)) {
      throw new PaymentError("Razorpay live credentials are not configured");
    }

    // If live credentials are explicitly enabled and fetch is requested via env flag, call Razorpay Orders API
    if (
      credentials?.environment === "live" &&
      credentials?.keyId &&
      credentials?.keySecret &&
      process.env.ENABLE_LIVE_PAYMENT_PROVIDER_HTTP === "true"
    ) {
      const auth = Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64");
      const resp = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: input.amountMinorUnits,
          currency: input.currency,
          receipt: input.orderNumber,
          notes: {
            orderId: input.orderId,
            ...(input.metadata || {}),
          },
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new PaymentError(`Razorpay order creation failed: ${resp.status} ${text.slice(0, 200)}`);
      }
      const data = await resp.json();
      return {
        providerOrderId: data.id,
        status: "CREATED",
        checkoutData: { keyId: credentials.keyId, orderId: data.id },
        raw: data,
      };
    }

    const providerOrderId = `order_${crypto.createHash("sha256").update(`rzp:${input.idempotencyKey}`).digest("hex").slice(0, 14)}`;
    return {
      providerOrderId,
      status: "CREATED",
      checkoutData: {
        provider: "RAZORPAY",
        environment: credentials?.environment || "sandbox",
        orderId: providerOrderId,
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency,
      },
      raw: { id: providerOrderId, entity: "order", amount: input.amountMinorUnits, currency: input.currency },
    };
  }

  async authorizePayment(input: AuthorizeProviderPaymentInput) {
    const providerPaymentId =
      input.providerPaymentId ||
      `pay_${crypto.createHash("sha256").update(`rzp:${input.idempotencyKey}`).digest("hex").slice(0, 14)}`;
    return {
      providerPaymentId,
      status: "AUTHORIZED" as const,
      amountMinorUnits: input.amountMinorUnits,
      raw: { id: providerPaymentId, order_id: input.providerOrderId, status: "authorized" },
    };
  }

  async capturePayment(input: CaptureProviderPaymentInput) {
    const providerPaymentId =
      input.providerPaymentId ||
      `pay_${crypto.createHash("sha256").update(`rzp:${input.idempotencyKey}`).digest("hex").slice(0, 14)}`;
    return {
      providerPaymentId,
      status: "CAPTURED" as const,
      capturedMinorUnits: input.amountMinorUnits,
      raw: { id: providerPaymentId, amount: input.amountMinorUnits, status: "captured" },
    };
  }

  async verifyPayment(
    input: {
      providerOrderId?: string | null;
      providerPaymentId?: string | null;
      signature?: string | null;
    },
    credentials?: ProviderCredentials | null
  ) {
    if (input.signature && credentials?.keySecret && input.providerOrderId && input.providerPaymentId) {
      const expected = crypto
        .createHmac("sha256", credentials.keySecret)
        .update(`${input.providerOrderId}|${input.providerPaymentId}`)
        .digest("hex");
      const ok = timingSafeHexCompare(expected, input.signature);
      return {
        verified: ok,
        status: (ok ? "VERIFIED" : "FAILED") as "VERIFIED" | "FAILED",
        raw: { signatureVerified: ok },
      };
    }

    return {
      verified: Boolean(input.providerPaymentId),
      status: (input.providerPaymentId ? "VERIFIED" : "PENDING") as "VERIFIED" | "PENDING",
      raw: { ...input },
    };
  }

  async cancelPayment(input: { providerOrderId?: string | null }) {
    return {
      cancelled: true,
      status: "CANCELLED" as const,
      raw: { id: input.providerOrderId, status: "cancelled" },
    };
  }

  async refundPayment(input: RefundProviderPaymentInput) {
    const providerRefundId = `rfnd_${crypto.createHash("sha256").update(`rzp_ref:${input.idempotencyKey}`).digest("hex").slice(0, 14)}`;
    return {
      providerRefundId,
      status: "COMPLETED" as const,
      refundedMinorUnits: input.amountMinorUnits,
      raw: {
        id: providerRefundId,
        payment_id: input.providerPaymentId,
        amount: input.amountMinorUnits,
        status: "processed",
      },
    };
  }

  async getPaymentStatus(input: { providerOrderId?: string | null; providerPaymentId?: string | null }) {
    return {
      status: "created",
      raw: { ...input },
    };
  }

  /**
   * Verifies Razorpay HMAC SHA-256 webhook signature (`X-Razorpay-Signature`).
   */
  verifyWebhookSignature(rawPayload: string, signature: string | null, secret?: string | null): boolean {
    if (!secret || !signature) return false;
    const expected = crypto.createHmac("sha256", secret).update(rawPayload, "utf8").digest("hex");
    return timingSafeHexCompare(expected, signature);
  }

  parseWebhookEvent(payload: any): NormalizedPaymentWebhookEvent | null {
    if (!payload || typeof payload !== "object" || !payload.event) return null;
    const paymentEntity = payload.payload?.payment?.entity;
    const refundEntity = payload.payload?.refund?.entity;
    const orderEntity = payload.payload?.order?.entity;

    const eventType = String(payload.event);
    const providerEventId =
      payload.id ||
      `${eventType}:${paymentEntity?.id || refundEntity?.id || orderEntity?.id || ""}:${payload.created_at || ""}`;

    let outcome: NormalizedPaymentWebhookEvent["outcome"] = "IGNORED";
    if (eventType === "payment.authorized") outcome = "AUTHORIZED";
    else if (eventType === "payment.captured" || eventType === "order.paid") outcome = "CAPTURED";
    else if (eventType === "payment.failed") outcome = "FAILED";
    else if (eventType === "refund.created") outcome = "REFUND_PROCESSING";
    else if (eventType === "refund.processed") outcome = "REFUND_COMPLETED";
    else if (eventType === "refund.failed") outcome = "REFUND_FAILED";

    const notes = paymentEntity?.notes || refundEntity?.notes || orderEntity?.notes || {};
    const occurredAt =
      typeof payload.created_at === "number"
        ? new Date(payload.created_at * 1000)
        : undefined;

    return {
      providerEventId: String(providerEventId),
      eventType,
      occurredAt,
      accountIdentifier: payload.account_id,
      businessIdHint: notes.businessId,
      orderIdHint: notes.orderId,
      providerOrderId: paymentEntity?.order_id || orderEntity?.id,
      providerPaymentId: paymentEntity?.id || refundEntity?.payment_id,
      providerRefundId: refundEntity?.id,
      amountMinorUnits:
        typeof refundEntity?.amount === "number"
          ? refundEntity.amount
          : typeof paymentEntity?.amount === "number"
          ? paymentEntity.amount
          : typeof orderEntity?.amount_paid === "number"
          ? orderEntity.amount_paid
          : undefined,
      currency: paymentEntity?.currency || refundEntity?.currency || orderEntity?.currency,
      outcome,
      failureCode: paymentEntity?.error_code,
      failureReason: paymentEntity?.error_description,
      raw: payload,
    };
  }
}

export class StripePaymentAdapter implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.STRIPE;

  async createPayment(
    input: CreateProviderPaymentInput,
    credentials?: ProviderCredentials | null
  ): Promise<CreateProviderPaymentResult> {
    if (credentials?.environment === "live" && !credentials?.keySecret) {
      throw new PaymentError("Stripe live credentials are not configured");
    }

    const providerOrderId = `pi_${crypto.createHash("sha256").update(`stripe:${input.idempotencyKey}`).digest("hex").slice(0, 20)}`;
    return {
      providerOrderId,
      status: "CREATED",
      checkoutData: {
        provider: "STRIPE",
        environment: credentials?.environment || "sandbox",
        paymentIntentId: providerOrderId,
        amountMinorUnits: input.amountMinorUnits,
        currency: input.currency,
      },
      raw: { id: providerOrderId, object: "payment_intent", amount: input.amountMinorUnits, currency: input.currency.toLowerCase() },
    };
  }

  async authorizePayment(input: AuthorizeProviderPaymentInput) {
    const providerPaymentId =
      input.providerPaymentId ||
      input.providerOrderId ||
      `ch_${crypto.createHash("sha256").update(`stripe:${input.idempotencyKey}`).digest("hex").slice(0, 20)}`;
    return {
      providerPaymentId,
      status: "AUTHORIZED" as const,
      amountMinorUnits: input.amountMinorUnits,
      raw: { id: providerPaymentId, status: "requires_capture" },
    };
  }

  async capturePayment(input: CaptureProviderPaymentInput) {
    const providerPaymentId =
      input.providerPaymentId ||
      input.providerOrderId ||
      `ch_${crypto.createHash("sha256").update(`stripe:${input.idempotencyKey}`).digest("hex").slice(0, 20)}`;
    return {
      providerPaymentId,
      status: "CAPTURED" as const,
      capturedMinorUnits: input.amountMinorUnits,
      raw: { id: providerPaymentId, amount_received: input.amountMinorUnits, status: "succeeded" },
    };
  }

  async verifyPayment(input: { providerOrderId?: string | null; providerPaymentId?: string | null }) {
    return {
      verified: Boolean(input.providerPaymentId || input.providerOrderId),
      status: (input.providerPaymentId || input.providerOrderId ? "VERIFIED" : "PENDING") as
        | "VERIFIED"
        | "PENDING",
      raw: { ...input },
    };
  }

  async cancelPayment(input: { providerOrderId?: string | null }) {
    return {
      cancelled: true,
      status: "CANCELLED" as const,
      raw: { id: input.providerOrderId, status: "canceled" },
    };
  }

  async refundPayment(input: RefundProviderPaymentInput) {
    const providerRefundId = `re_${crypto.createHash("sha256").update(`stripe_ref:${input.idempotencyKey}`).digest("hex").slice(0, 20)}`;
    return {
      providerRefundId,
      status: "COMPLETED" as const,
      refundedMinorUnits: input.amountMinorUnits,
      raw: { id: providerRefundId, amount: input.amountMinorUnits, status: "succeeded" },
    };
  }

  async getPaymentStatus(input: { providerOrderId?: string | null }) {
    return { status: "requires_payment_method", raw: { ...input } };
  }

  /**
   * Verifies Stripe `Stripe-Signature` header (`t=<timestamp>,v1=<hmac_sha256>`).
   */
  verifyWebhookSignature(rawPayload: string, signature: string | null, secret?: string | null): boolean {
    if (!secret || !signature) return false;
    const parts = signature.split(",").reduce<Record<string, string[]>>((acc, kv) => {
      const [k, v] = kv.split("=");
      if (k && v) {
        const key = k.trim();
        acc[key] = acc[key] || [];
        acc[key].push(v.trim());
      }
      return acc;
    }, {});

    const timestamp = parts["t"]?.[0];
    const signatures = parts["v1"] || [];
    if (!timestamp || signatures.length === 0) {
      // Also support bare HMAC hex in unit tests if needed? No — keep Stripe format strict!
      return false;
    }

    const signedPayload = `${timestamp}.${rawPayload}`;
    const expected = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
    return signatures.some((sig) => timingSafeHexCompare(expected, sig));
  }

  parseWebhookEvent(payload: any): NormalizedPaymentWebhookEvent | null {
    if (!payload || typeof payload !== "object" || !payload.id || !payload.type) return null;
    const obj = payload.data?.object || {};
    const eventType = String(payload.type);

    let outcome: NormalizedPaymentWebhookEvent["outcome"] = "IGNORED";
    if (eventType === "payment_intent.amount_capturable_updated") outcome = "AUTHORIZED";
    else if (eventType === "payment_intent.succeeded" || eventType === "charge.succeeded")
      outcome = "CAPTURED";
    else if (eventType === "payment_intent.payment_failed" || eventType === "charge.failed")
      outcome = "FAILED";
    else if (eventType === "charge.refund.updated" && obj.status === "pending")
      outcome = "REFUND_PROCESSING";
    else if (
      eventType === "charge.refunded" ||
      eventType === "refund.succeeded" ||
      (eventType === "charge.refund.updated" && obj.status === "succeeded")
    )
      outcome = "REFUND_COMPLETED";
    else if (eventType === "charge.refund.updated" && obj.status === "failed")
      outcome = "REFUND_FAILED";

    const metadata = obj.metadata || {};
    const occurredAt =
      typeof payload.created === "number" ? new Date(payload.created * 1000) : undefined;

    return {
      providerEventId: String(payload.id),
      eventType,
      occurredAt,
      accountIdentifier: payload.account,
      businessIdHint: metadata.businessId,
      orderIdHint: metadata.orderId,
      providerOrderId: obj.object === "payment_intent" ? obj.id : obj.payment_intent,
      providerPaymentId: obj.object === "charge" ? obj.id : obj.latest_charge || obj.id,
      providerRefundId: obj.object === "refund" ? obj.id : obj.refunds?.data?.[0]?.id,
      amountMinorUnits:
        typeof obj.amount_refunded === "number" && outcome === "REFUND_COMPLETED"
          ? obj.amount_refunded
          : typeof obj.amount_received === "number"
          ? obj.amount_received
          : typeof obj.amount === "number"
          ? obj.amount
          : undefined,
      currency: obj.currency ? String(obj.currency).toUpperCase() : undefined,
      outcome,
      failureCode: obj.last_payment_error?.code || obj.failure_code,
      failureReason: obj.last_payment_error?.message || obj.failure_message,
      raw: payload,
    };
  }
}

export class OtherPaymentAdapter extends ManualPaymentAdapter {
  override readonly provider: PaymentProvider = PaymentProvider.OTHER;
}

const adapters: Record<PaymentProvider, PaymentProviderAdapter> = {
  [PaymentProvider.MANUAL]: new ManualPaymentAdapter(),
  [PaymentProvider.RAZORPAY]: new RazorpayPaymentAdapter(),
  [PaymentProvider.STRIPE]: new StripePaymentAdapter(),
  [PaymentProvider.OTHER]: new OtherPaymentAdapter(),
};

export function getPaymentProvider(provider: PaymentProvider): PaymentProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new ValidationError(`Unsupported payment provider: ${provider}`);
  }
  return adapter;
}

/**
 * Strips encrypted credential strings so secrets never escape API responses or logs.
 */
export function sanitizePaymentProviderConfig(config: any) {
  if (!config) return null;
  const { encryptedCredentials, ...rest } = config;
  return {
    ...rest,
    hasCredentials: Boolean(encryptedCredentials),
  };
}

/**
 * Upserts encrypted payment provider configuration for a business tenant.
 */
export async function upsertPaymentProviderConfig(
  businessId: string,
  input: {
    provider: PaymentProvider;
    environment?: "sandbox" | "live";
    enabled?: boolean;
    accountIdentifier?: string | null;
    credentials?: ProviderCredentials | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const environment = input.environment || "sandbox";
  const existing = await prisma.paymentProviderConfig.findUnique({
    where: {
      businessId_provider_environment: {
        businessId,
        provider: input.provider,
        environment,
      },
    },
  });

  let encryptedCredentials = existing?.encryptedCredentials ?? null;
  if (input.credentials) {
    const existingCreds = encryptedCredentials
      ? safeDecryptCredentials(encryptedCredentials)
      : {};
    const merged: ProviderCredentials = {
      ...existingCreds,
      ...input.credentials,
      environment,
    };
    encryptedCredentials = encryptToken(JSON.stringify(merged));
  }

  const config = await prisma.paymentProviderConfig.upsert({
    where: {
      businessId_provider_environment: {
        businessId,
        provider: input.provider,
        environment,
      },
    },
    create: {
      businessId,
      provider: input.provider,
      environment,
      enabled: input.enabled ?? true,
      accountIdentifier: input.accountIdentifier ?? null,
      encryptedCredentials,
      status: ProviderHealthStatus.CONNECTED,
      lastVerifiedAt: new Date(),
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    update: {
      enabled: input.enabled ?? existing?.enabled ?? true,
      accountIdentifier:
        input.accountIdentifier !== undefined
          ? input.accountIdentifier
          : existing?.accountIdentifier,
      encryptedCredentials,
      status:
        input.enabled === false
          ? ProviderHealthStatus.DISABLED
          : ProviderHealthStatus.CONNECTED,
      lastVerifiedAt: new Date(),
      lastError: null,
      ...(input.metadata !== undefined
        ? { metadata: input.metadata as Prisma.InputJsonValue }
        : {}),
    },
  });

  logger.info("payment_provider_config.upserted", {
    configId: config.id,
    businessId,
    provider: config.provider,
    environment: config.environment,
    enabled: config.enabled,
  });

  return sanitizePaymentProviderConfig(config);
}

export async function getPaymentProviderConfigs(businessId: string) {
  const configs = await prisma.paymentProviderConfig.findMany({
    where: { businessId },
    orderBy: [{ provider: "asc" }, { environment: "asc" }],
  });
  return configs.map(sanitizePaymentProviderConfig);
}

export async function getPaymentProviderConfigById(businessId: string, configId: string) {
  const config = await prisma.paymentProviderConfig.findFirst({
    where: { id: configId, businessId },
  });
  return sanitizePaymentProviderConfig(config);
}

function safeDecryptCredentials(encrypted: string): ProviderCredentials {
  try {
    const raw = decryptToken(encrypted);
    return raw ? (JSON.parse(raw) as ProviderCredentials) : {};
  } catch {
    return {};
  }
}

/**
 * Resolves decrypted provider credentials strictly on server for provider operations & webhook validation.
 */
export async function getDecryptedPaymentProviderCredentials(
  businessId: string,
  provider: PaymentProvider,
  environment?: "sandbox" | "live"
): Promise<ProviderCredentials | null> {
  const config = await prisma.paymentProviderConfig.findFirst({
    where: {
      businessId,
      provider,
      enabled: true,
      ...(environment ? { environment } : {}),
    },
    orderBy: { environment: "desc" }, // prefer sandbox or explicit match
  });

  if (!config || !config.encryptedCredentials) return null;
  const creds = safeDecryptCredentials(config.encryptedCredentials);
  return {
    ...creds,
    environment: (config.environment as "sandbox" | "live") || "sandbox",
  };
}
