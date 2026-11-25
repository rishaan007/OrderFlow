import { prisma } from "./prisma";
import {
  PaymentProvider,
  PaymentIntentStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentRecordStatus,
  PaymentStatus,
  RefundStatus,
  WebhookProcessingStatus,
  LedgerEntryType,
  TimelineActor,
  TimelineVisibility,
  EvidenceType,
  EvidenceVerificationState,
  DeliveryPartner,
  Prisma,
} from "@prisma/client";
import {
  getPaymentProvider,
  getDecryptedPaymentProviderCredentials,
} from "./payment-provider";
import { getShippingProvider, recordTrackingEvent } from "./shipping-provider";
import { appendBalancedLedgerPair } from "./ledger";
import {
  assertValidTransition,
  PAYMENT_INTENT_TRANSITIONS,
  REFUND_TRANSITIONS,
} from "./state-machines";
import { minorUnitsToDecimal, minorUnitsToMajorString, normalizeCurrency, toMinorUnits } from "./money";
import { validatePayloadSize, validateReplayWindow } from "./social-events";
import { WebhookVerificationError, ValidationError } from "./errors";
import { logger } from "./logger";

/**
 * Resolves webhook secret & tenant strictly from configured provider credentials or matching entities.
 */
async function resolvePaymentWebhookContext(params: {
  provider: PaymentProvider;
  accountIdentifier?: string;
  businessIdHint?: string;
  providerOrderId?: string;
  providerRefundId?: string;
}) {
  // 1. Check matching PaymentIntent by providerOrderId
  if (params.providerOrderId) {
    const intent = await prisma.paymentIntent.findFirst({
      where: {
        provider: params.provider,
        providerOrderId: params.providerOrderId,
      },
      include: { order: { include: { socialTransaction: true } }, attempts: true },
    });
    if (intent) {
      return { businessId: intent.businessId, intent, refund: null };
    }
  }

  // 2. Check matching Refund by providerRefundId
  if (params.providerRefundId) {
    const refund = await prisma.refund.findFirst({
      where: {
        provider: params.provider,
        providerRefundId: params.providerRefundId,
      },
      include: { order: { include: { socialTransaction: true } }, paymentIntent: true },
    });
    if (refund) {
      return { businessId: refund.businessId, intent: null, refund };
    }
  }

  // 3. Check PaymentProviderConfig by accountIdentifier
  if (params.accountIdentifier) {
    const config = await prisma.paymentProviderConfig.findFirst({
      where: {
        provider: params.provider,
        accountIdentifier: params.accountIdentifier,
        enabled: true,
      },
    });
    if (config) {
      return { businessId: config.businessId, intent: null, refund: null };
    }
  }

  // 4. Fallback to explicit businessIdHint only when config exists for that tenant
  if (params.businessIdHint) {
    const business = await prisma.business.findUnique({
      where: { id: params.businessIdHint },
      select: { id: true },
    });
    if (business) {
      return { businessId: business.id, intent: null, refund: null };
    }
  }

  return { businessId: null, intent: null, refund: null };
}

/**
 * Verifies, deduplicates, logs, and processes an inbound payment provider webhook.
 */
export async function processPaymentWebhook(input: {
  provider: PaymentProvider;
  rawBody: string;
  signature: string | null;
  webhookSecretOverride?: string | null;
  skipReplayCheck?: boolean;
}) {
  if (!validatePayloadSize(input.rawBody)) {
    throw new ValidationError("Webhook payload exceeds maximum 1MB limit");
  }

  let payload: any;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    throw new ValidationError("Malformed webhook JSON payload");
  }

  const adapter = getPaymentProvider(input.provider);
  const parsed = adapter.parseWebhookEvent(payload);
  if (!parsed) {
    return { status: "IGNORED", reason: "Unrecognized payment webhook payload format" };
  }

  // Replay protection
  if (parsed.occurredAt && !input.skipReplayCheck && !validateReplayWindow(parsed.occurredAt)) {
    throw new WebhookVerificationError("Webhook event timestamp outside valid replay window");
  }

  const ctx = await resolvePaymentWebhookContext({
    provider: input.provider,
    accountIdentifier: parsed.accountIdentifier,
    businessIdHint: parsed.businessIdHint,
    providerOrderId: parsed.providerOrderId,
    providerRefundId: parsed.providerRefundId,
  });

  // Resolve configured webhook secret
  let secret = input.webhookSecretOverride || null;
  if (!secret && ctx.businessId) {
    const creds = await getDecryptedPaymentProviderCredentials(ctx.businessId, input.provider);
    secret = creds?.webhookSecret || null;
  }
  if (!secret) {
    if (input.provider === PaymentProvider.RAZORPAY) {
      secret = process.env.RAZORPAY_WEBHOOK_SECRET || null;
    } else if (input.provider === PaymentProvider.STRIPE) {
      secret = process.env.STRIPE_WEBHOOK_SECRET || null;
    } else {
      secret = process.env.PAYMENT_WEBHOOK_SECRET || null;
    }
  }

  // Signature verification MUST succeed when a secret is configured or always in strict mode
  const signatureVerified = secret
    ? adapter.verifyWebhookSignature(input.rawBody, input.signature, secret)
    : false;

  if (!signatureVerified) {
    logger.warn("payment_webhook.invalid_signature", {
      provider: input.provider,
      providerEventId: parsed.providerEventId,
      businessId: ctx.businessId ?? undefined,
    });
    throw new WebhookVerificationError("Invalid payment webhook signature");
  }

  // Tenant mismatch check if both context & payload hint disagree
  if (
    ctx.intent &&
    parsed.businessIdHint &&
    ctx.intent.businessId !== parsed.businessIdHint
  ) {
    throw new WebhookVerificationError("Tenant mismatch in payment webhook payload");
  }

  // Atomic deduplication via ProviderWebhookEvent [provider, providerEventId]
  let webhookRecord: any;
  try {
    webhookRecord = await prisma.providerWebhookEvent.create({
      data: {
        domain: "PAYMENT",
        provider: input.provider,
        providerEventId: parsed.providerEventId,
        eventType: parsed.eventType,
        businessId: ctx.businessId,
        signatureVerified: true,
        occurredAt: parsed.occurredAt ?? new Date(),
        processingStatus: WebhookProcessingStatus.RECEIVED,
        payload: payload as Prisma.InputJsonValue,
        metadata: {
          providerOrderId: parsed.providerOrderId,
          providerPaymentId: parsed.providerPaymentId,
          providerRefundId: parsed.providerRefundId,
          amountMinorUnits: parsed.amountMinorUnits,
          currency: parsed.currency,
          orderId: ctx.intent?.orderId || parsed.orderIdHint,
        },
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const existing = await prisma.providerWebhookEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: input.provider,
            providerEventId: parsed.providerEventId,
          },
        },
      });
      return {
        status: "DUPLICATE",
        duplicate: true,
        event: existing,
      };
    }
    throw err;
  }

  if (!ctx.businessId) {
    await prisma.providerWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: WebhookProcessingStatus.IGNORED,
        error: "Unable to resolve business tenant for payment webhook",
        processedAt: new Date(),
      },
    });
    return {
      status: "IGNORED",
      duplicate: false,
      event: webhookRecord,
      reason: "Unknown tenant for webhook event",
    };
  }

  try {
    let normalizedEntityType: string | null = null;
    let normalizedEntityId: string | null = null;

    if (ctx.intent && parsed.outcome === "AUTHORIZED") {
      assertValidTransition(
        "PaymentIntent",
        PAYMENT_INTENT_TRANSITIONS,
        ctx.intent.status,
        PaymentIntentStatus.AUTHORIZED
      );
      await prisma.$transaction(async (tx) => {
        await tx.paymentIntent.update({
          where: { id: ctx.intent!.id },
          data: { status: PaymentIntentStatus.AUTHORIZED },
        });
        if (parsed.providerPaymentId) {
          const existingAtt = await tx.paymentAttempt.findFirst({
            where: {
              provider: input.provider,
              providerPaymentId: parsed.providerPaymentId,
            },
          });
          if (!existingAtt) {
            await tx.paymentAttempt.create({
              data: {
                paymentIntentId: ctx.intent!.id,
                businessId: ctx.businessId!,
                attemptNumber: ctx.intent!.attempts.length + 1,
                provider: input.provider,
                providerPaymentId: parsed.providerPaymentId,
                providerOrderId: ctx.intent!.providerOrderId,
                amountMinorUnits: parsed.amountMinorUnits ?? ctx.intent!.amountMinorUnits,
                currency: parsed.currency ? normalizeCurrency(parsed.currency) : ctx.intent!.currency,
                status: PaymentAttemptStatus.AUTHORIZED,
                idempotencyKey: `wh:${parsed.providerEventId}`,
              },
            });
          }
        }
      });
      normalizedEntityType = "PAYMENT_INTENT";
      normalizedEntityId = ctx.intent.id;
    } else if (ctx.intent && parsed.outcome === "CAPTURED") {
      const capturedAmount = parsed.amountMinorUnits ?? ctx.intent.amountMinorUnits;
      const newTotalCaptured = Math.max(ctx.intent.capturedMinorUnits, capturedAmount);
      const nextIntentStatus =
        newTotalCaptured >= ctx.intent.amountMinorUnits
          ? PaymentIntentStatus.CAPTURED
          : PaymentIntentStatus.PARTIALLY_CAPTURED;

      assertValidTransition(
        "PaymentIntent",
        PAYMENT_INTENT_TRANSITIONS,
        ctx.intent.status,
        nextIntentStatus
      );

      await prisma.$transaction(async (tx) => {
        await tx.paymentIntent.update({
          where: { id: ctx.intent!.id },
          data: {
            status: nextIntentStatus,
            capturedMinorUnits: newTotalCaptured,
          },
        });

        const existingPay = parsed.providerPaymentId
          ? await tx.payment.findFirst({
              where: {
                businessId: ctx.businessId!,
                provider: input.provider,
                providerPaymentId: parsed.providerPaymentId,
              },
            })
          : null;

        let paymentId = existingPay?.id;
        if (!existingPay) {
          const pay = await tx.payment.create({
            data: {
              businessId: ctx.businessId!,
              orderId: ctx.intent!.orderId,
              customerId: ctx.intent!.order.customerId,
              paymentIntentId: ctx.intent!.id,
              amount: minorUnitsToDecimal(capturedAmount, ctx.intent!.currency),
              amountMinorUnits: capturedAmount,
              currency: ctx.intent!.currency,
              method:
                input.provider === PaymentProvider.RAZORPAY
                  ? PaymentMethod.RAZORPAY
                  : input.provider === PaymentProvider.STRIPE
                  ? PaymentMethod.STRIPE
                  : PaymentMethod.OTHER,
              provider: input.provider,
              providerPaymentId: parsed.providerPaymentId || parsed.providerEventId,
              idempotencyKey: `wh:${parsed.providerEventId}`,
              status: PaymentRecordStatus.VERIFIED,
              referenceNumber: parsed.providerPaymentId || parsed.providerEventId,
              verifiedBy: `${input.provider}_WEBHOOK`,
              verifiedAt: new Date(),
            },
          });
          paymentId = pay.id;
        }

        await appendBalancedLedgerPair(
          {
            businessId: ctx.businessId!,
            orderId: ctx.intent!.orderId,
            socialTransactionId: ctx.intent!.socialTransactionId,
            paymentId,
            paymentIntentId: ctx.intent!.id,
            entryType: LedgerEntryType.PAYMENT_CAPTURED,
            debitAccount: "PROVIDER_CLEARING",
            creditAccount: "ORDER_RECEIVABLE",
            amountMinorUnits: capturedAmount,
            currency: ctx.intent!.currency,
            referenceType: "WEBHOOK_EVENT",
            referenceId: webhookRecord.id,
            provider: input.provider,
            providerEventId: parsed.providerEventId,
            idempotencyKeyPrefix: `wh:${parsed.providerEventId}`,
            description: `Webhook confirmed capture of ${minorUnitsToMajorString(capturedAmount, ctx.intent!.currency)} ${ctx.intent!.currency}`,
          },
          tx
        );

        const orderTotalMinor = toMinorUnits(ctx.intent!.order.totalAmount, ctx.intent!.currency);
        const capturedLedger = await tx.ledgerEntry.aggregate({
          where: {
            businessId: ctx.businessId!,
            orderId: ctx.intent!.orderId,
            account: "ORDER_RECEIVABLE",
            entryType: {
              in: [LedgerEntryType.PAYMENT_CAPTURED, LedgerEntryType.PAYMENT_RECEIVED],
            },
            direction: "CREDIT",
          },
          _sum: { amountMinorUnits: true },
        });
        const totalPaidMinor = capturedLedger._sum.amountMinorUnits || 0;
        const payStatus =
          totalPaidMinor >= orderTotalMinor
            ? PaymentStatus.PAID
            : totalPaidMinor > 0
            ? PaymentStatus.PARTIALLY_PAID
            : PaymentStatus.PENDING;

        await tx.order.update({
          where: { id: ctx.intent!.orderId },
          data: {
            amountPaid: minorUnitsToDecimal(totalPaidMinor, ctx.intent!.currency),
            paymentStatus: payStatus,
          },
        });

        if (ctx.intent!.order.socialTransaction) {
          await tx.transactionTimelineEvent.create({
            data: {
              transactionId: ctx.intent!.order.socialTransaction.id,
              eventType: "PAYMENT_WEBHOOK_CAPTURED",
              title: `Payment Confirmed by ${input.provider}`,
              description: `Webhook verified payment ${parsed.providerPaymentId || parsed.providerEventId}`,
              actor: TimelineActor.SYSTEM,
              visibility: TimelineVisibility.PUBLIC,
            },
          });
          await tx.transactionEvidence.create({
            data: {
              transactionId: ctx.intent!.order.socialTransaction.id,
              evidenceType: EvidenceType.PAYMENT_VERIFICATION,
              verificationState: EvidenceVerificationState.SYSTEM_GENERATED,
              source: `WEBHOOK:${input.provider}`,
              actor: TimelineActor.SYSTEM,
              notes: `Webhook event ${parsed.providerEventId} verified payment`,
            },
          });
        }
      });

      normalizedEntityType = "PAYMENT_INTENT";
      normalizedEntityId = ctx.intent.id;
    } else if (ctx.intent && parsed.outcome === "FAILED") {
      assertValidTransition(
        "PaymentIntent",
        PAYMENT_INTENT_TRANSITIONS,
        ctx.intent.status,
        PaymentIntentStatus.FAILED
      );

      await prisma.$transaction(async (tx) => {
        await tx.paymentIntent.update({
          where: { id: ctx.intent!.id },
          data: { status: PaymentIntentStatus.FAILED },
        });

        await tx.paymentAttempt.create({
          data: {
            paymentIntentId: ctx.intent!.id,
            businessId: ctx.businessId!,
            attemptNumber: ctx.intent!.attempts.length + 1,
            provider: input.provider,
            providerPaymentId: parsed.providerPaymentId || `fail_${parsed.providerEventId}`,
            providerOrderId: ctx.intent!.providerOrderId,
            amountMinorUnits: parsed.amountMinorUnits ?? ctx.intent!.amountMinorUnits,
            currency: parsed.currency ? normalizeCurrency(parsed.currency) : ctx.intent!.currency,
            status: PaymentAttemptStatus.FAILED,
            failureCode: parsed.failureCode || "WEBHOOK_FAILURE",
            failureReason: parsed.failureReason || "Payment failed at provider",
            idempotencyKey: `wh:${parsed.providerEventId}`,
          },
        });
      });

      normalizedEntityType = "PAYMENT_INTENT";
      normalizedEntityId = ctx.intent.id;
    } else if (ctx.refund && parsed.outcome === "REFUND_COMPLETED") {
      if (ctx.refund.status !== RefundStatus.COMPLETED) {
        assertValidTransition(
          "Refund",
          REFUND_TRANSITIONS,
          ctx.refund.status,
          RefundStatus.COMPLETED
        );
        await prisma.refund.update({
          where: { id: ctx.refund.id },
          data: {
            status: RefundStatus.COMPLETED,
            processedAt: new Date(),
          },
        });
      }
      normalizedEntityType = "REFUND";
      normalizedEntityId = ctx.refund.id;
    }

    const processedEvent = await prisma.providerWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: WebhookProcessingStatus.PROCESSED,
        processedAt: new Date(),
        normalizedEntityType,
        normalizedEntityId,
      },
    });

    await prisma.auditLog.create({
      data: {
        businessId: ctx.businessId,
        action: "PAYMENT_WEBHOOK_PROCESSED",
        entityType: "PROVIDER_WEBHOOK_EVENT",
        entityId: processedEvent.id,
        metadata: {
          provider: input.provider,
          eventType: parsed.eventType,
          outcome: parsed.outcome,
          normalizedEntityType,
          normalizedEntityId,
        },
      },
    });

    return {
      status: "PROCESSED",
      duplicate: false,
      outcome: parsed.outcome,
      event: processedEvent,
    };
  } catch (err: any) {
    await prisma.providerWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: WebhookProcessingStatus.FAILED,
        error: err?.message || "Webhook processing failed",
      },
    });
    throw err;
  }
}

/**
 * Verifies, deduplicates, and applies an inbound carrier logistics webhook.
 */
export async function processLogisticsWebhook(input: {
  provider: string;
  rawBody: string;
  signature: string | null;
  webhookSecretOverride?: string | null;
  skipReplayCheck?: boolean;
}) {
  if (!validatePayloadSize(input.rawBody)) {
    throw new ValidationError("Webhook payload exceeds maximum 1MB limit");
  }

  let payload: any;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    throw new ValidationError("Malformed logistics webhook JSON payload");
  }

  const carrier = (input.provider.toUpperCase() as DeliveryPartner) || DeliveryPartner.OTHER;
  const adapter = getShippingProvider(carrier);
  const parsed = adapter.parseTrackingWebhook(payload);

  if (!parsed) {
    return { status: "IGNORED", reason: "Unrecognized logistics webhook payload" };
  }

  if (!input.skipReplayCheck && !validateReplayWindow(parsed.occurredAt)) {
    throw new WebhookVerificationError("Logistics webhook event timestamp outside valid replay window");
  }

  // Signature verification
  const secret =
    input.webhookSecretOverride ||
    process.env.LOGISTICS_WEBHOOK_SECRET ||
    null;

  if (!secret || !adapter.verifyWebhookSignature(input.rawBody, input.signature, secret)) {
    throw new WebhookVerificationError("Invalid logistics webhook signature");
  }

  // Strictly find matching shipment without cross-tenant guess
  const shipment = await prisma.shipment.findFirst({
    where: {
      OR: [
        ...(parsed.shipmentIdHint ? [{ id: parsed.shipmentIdHint }] : []),
        ...(parsed.providerShipmentId
          ? [{ providerShipmentId: parsed.providerShipmentId }]
          : []),
        ...(parsed.trackingNumber ? [{ trackingNumber: parsed.trackingNumber }] : []),
      ],
    },
  });

  if (shipment && parsed.businessIdHint && shipment.businessId !== parsed.businessIdHint) {
    throw new WebhookVerificationError("Tenant mismatch in logistics webhook payload");
  }

  // Atomic deduplication
  let webhookRecord: any;
  try {
    webhookRecord = await prisma.providerWebhookEvent.create({
      data: {
        domain: "LOGISTICS",
        provider: adapter.providerName,
        providerEventId: parsed.providerEventId,
        eventType: parsed.eventType,
        businessId: shipment?.businessId || parsed.businessIdHint || null,
        signatureVerified: true,
        occurredAt: parsed.occurredAt,
        processingStatus: WebhookProcessingStatus.RECEIVED,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const existing = await prisma.providerWebhookEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: adapter.providerName,
            providerEventId: parsed.providerEventId,
          },
        },
      });
      return { status: "DUPLICATE", duplicate: true, event: existing };
    }
    throw err;
  }

  if (!shipment) {
    await prisma.providerWebhookEvent.update({
      where: { id: webhookRecord.id },
      data: {
        processingStatus: WebhookProcessingStatus.IGNORED,
        error: "Matching shipment not found",
        processedAt: new Date(),
      },
    });
    return { status: "IGNORED", duplicate: false, event: webhookRecord };
  }

  const trackingResult = await recordTrackingEvent(shipment.businessId, shipment.id, {
    provider: adapter.providerName,
    providerEventId: parsed.providerEventId,
    trackingNumber: parsed.trackingNumber,
    status: parsed.status,
    rawStatus: parsed.rawStatus,
    description: parsed.description,
    location: parsed.location,
    occurredAt: parsed.occurredAt,
    rawEventData: parsed.raw,
  });

  const processed = await prisma.providerWebhookEvent.update({
    where: { id: webhookRecord.id },
    data: {
      processingStatus: WebhookProcessingStatus.PROCESSED,
      processedAt: new Date(),
      normalizedEntityType: "SHIPMENT",
      normalizedEntityId: shipment.id,
    },
  });

  return {
    status: "PROCESSED",
    duplicate: false,
    shipmentStatus: trackingResult.shipment.status,
    event: processed,
  };
}
