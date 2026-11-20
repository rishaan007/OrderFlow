import { prisma } from "@/lib/prisma";
import {
  SocialPlatform,
  ConversationChannel,
  MessageSenderType,
  MessageType,
  TimelineActor,
  TimelineVisibility,
  Prisma,
} from "@prisma/client";
import { getSocialProvider } from "@/lib/providers/registry";
import { getDecryptedConnectionCredentials } from "./connections";
import { logSocialEvent } from "./social-events";

export type OutboundMessageType =
  | "TRANSACTION_LINK"
  | "PAYMENT_REQUEST"
  | "ORDER_CONFIRMATION"
  | "SHIPMENT_UPDATE"
  | "CUSTOM";

export type OutboundDeliveryStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "MANUAL_DISPATCH_REQUIRED";

export interface SendOutboundMessageInput {
  businessId: string;
  conversationId: string;
  messageType: OutboundMessageType;
  customText?: string;
  transactionId?: string;
  orderId?: string;
  idempotencyKey?: string;
}

export interface OutboundMessageResult {
  success: boolean;
  status: OutboundDeliveryStatus;
  messageId?: string;
  content: string;
  error?: string;
  platform: SocialPlatform;
  recipientId: string;
  timestamp: Date;
}

/**
 * Safe retry with bounded exponential backoff and rate-limit awareness
 */
async function executeWithBoundedRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 500
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt > maxRetries) throw err;

      // Check for rate limit / Retry-After
      const retryAfterSeconds = err?.retryAfter || Math.pow(2, attempt);
      const delay = Math.min(retryAfterSeconds * 1000, 5000) + Math.random() * 200;

      logSocialEvent("RATE_LIMITED", {
        attempt,
        retryDelayMs: delay,
        error: err?.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Dispatches a structured, platform-appropriate outbound message
 */
export async function sendOutboundSocialMessage(
  input: SendOutboundMessageInput
): Promise<OutboundMessageResult> {
  const {
    businessId,
    conversationId,
    messageType,
    customText,
    transactionId,
    orderId,
    idempotencyKey,
  } = input;

  // 1. Verify conversation belongs to tenant
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, businessId },
    include: {
      customer: true,
      business: { select: { name: true, profile: true } },
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found in current workspace");
  }

  // 2. Check Idempotency Key to prevent duplicate outbound messages
  if (idempotencyKey) {
    const existing = await prisma.message.findFirst({
      where: {
        conversationId,
        metadata: {
          path: ["idempotencyKey"],
          equals: idempotencyKey,
        },
      },
    });

    if (existing) {
      logSocialEvent("EVENT_DUPLICATED", {
        idempotencyKey,
        messageId: existing.id,
        reason: "Duplicate outbound message prevented by idempotency key",
      });

      return {
        success: true,
        status: "SENT",
        messageId: existing.externalMessageId || existing.id,
        content: existing.content,
        platform: SocialPlatform.MANUAL,
        recipientId: conversation.contactIdentifier,
        timestamp: existing.createdAt,
      };
    }
  }

  // 3. Map conversation channel to SocialPlatform
  const platformMap: Record<ConversationChannel, SocialPlatform> = {
    [ConversationChannel.INSTAGRAM]: SocialPlatform.INSTAGRAM,
    [ConversationChannel.WHATSAPP]: SocialPlatform.WHATSAPP,
    [ConversationChannel.FACEBOOK]: SocialPlatform.FACEBOOK,
    [ConversationChannel.X]: SocialPlatform.X,
    [ConversationChannel.MANUAL]: SocialPlatform.MANUAL,
    [ConversationChannel.OTHER]: SocialPlatform.OTHER,
  };

  const platform = platformMap[conversation.channel] || SocialPlatform.MANUAL;

  // 4. Resolve Transaction & Order Details if provided
  let trackingToken: string | null = null;
  let orderNumber: string | null = null;
  let totalAmount: string | null = null;

  if (transactionId) {
    const txn = await prisma.socialTransaction.findFirst({
      where: { id: transactionId, businessId },
      include: { order: true },
    });
    if (txn) {
      trackingToken = txn.publicTrackingToken;
      orderNumber = txn.order?.orderNumber || null;
      totalAmount = txn.order ? String(txn.order.totalAmount) : null;
    }
  } else if (orderId) {
    const ord = await prisma.order.findFirst({
      where: { id: orderId, businessId },
      include: { socialTransaction: true },
    });
    if (ord) {
      orderNumber = ord.orderNumber;
      totalAmount = String(ord.totalAmount);
      trackingToken = ord.socialTransaction?.publicTrackingToken || null;
    }
  }

  const roomLink = trackingToken
    ? `https://orderflow.app/t/${trackingToken}`
    : "https://orderflow.app";

  // 5. Build standard template content based on messageType
  let text = customText || "";
  if (!text) {
    switch (messageType) {
      case "TRANSACTION_LINK":
        text = `Hi! Here is your secure OrderFlow transaction room link: ${roomLink}. You can verify item details, upload payment proof, and track your package live.`;
        break;
      case "PAYMENT_REQUEST":
        text = `Your order ${orderNumber ? `#${orderNumber}` : ""} ($${totalAmount || "0"}) is ready for payment! Please complete your transfer and upload payment proof here: ${roomLink}`;
        break;
      case "ORDER_CONFIRMATION":
        text = `Thank you! Your order ${orderNumber ? `#${orderNumber}` : ""} has been confirmed. View your receipt and live delivery status: ${roomLink}`;
        break;
      case "SHIPMENT_UPDATE":
        text = `Great news! Your package is on its way. Track your delivery status in real-time: ${roomLink}`;
        break;
      case "CUSTOM":
      default:
        text = `Hello from ${conversation.business.name}: ${roomLink}`;
        break;
    }
  }

  // 6. Handle Manual / Unsupported Channels
  if (platform === SocialPlatform.MANUAL || platform === SocialPlatform.OTHER) {
    const savedMsg = await prisma.message.create({
      data: {
        conversationId,
        senderType: MessageSenderType.SELLER,
        senderName: conversation.business.name || "Seller",
        content: text,
        messageType: MessageType.TEXT,
        metadata: {
          idempotencyKey,
          outboundType: messageType,
          status: "MANUAL_DISPATCH_REQUIRED",
        } as Prisma.InputJsonValue,
      },
    });

    return {
      success: true,
      status: "MANUAL_DISPATCH_REQUIRED",
      messageId: savedMsg.id,
      content: text,
      platform,
      recipientId: conversation.contactIdentifier,
      timestamp: new Date(),
    };
  }

  // 7. Resolve decrypted credentials for connected platform
  const credentials = await getDecryptedConnectionCredentials(
    businessId,
    platform
  );

  const provider = getSocialProvider(platform);
  const recipientId = conversation.externalChatId || conversation.contactIdentifier;

  let dispatchResult: { success: boolean; messageId?: string; error?: string } = {
    success: false,
  };

  try {
    dispatchResult = await executeWithBoundedRetry(async () => {
      return await provider.sendDirectMessage(
        recipientId,
        { text },
        {
          accessToken: credentials?.accessToken,
          phoneNumberId: credentials?.accountIdentifier,
        }
      );
    });
  } catch (err: any) {
    dispatchResult = {
      success: false,
      messageId: undefined,
      error: err.message || `Outbound message dispatch failed on ${platform}`,
    };
  }

  // 8. Truthful Delivery Status Reporting
  // We NEVER mark as DELIVERED unless provider delivery receipt arrives
  const isManualFallback =
    !dispatchResult.success &&
    (!credentials?.accessToken ||
      dispatchResult.error?.includes("not configured"));

  const status: OutboundDeliveryStatus = dispatchResult.success
    ? "SENT"
    : isManualFallback
    ? "MANUAL_DISPATCH_REQUIRED"
    : "FAILED";

  const isSuccess = dispatchResult.success || isManualFallback;

  // 9. Persist outbound message in database
  const created = await prisma.message.create({
    data: {
      conversationId,
      senderType: MessageSenderType.SELLER,
      senderName: conversation.business.name || "Seller",
      content: text,
      messageType: MessageType.TEXT,
      externalMessageId: dispatchResult.messageId || null,
      metadata: {
        idempotencyKey,
        outboundType: messageType,
        status,
        providerError: dispatchResult.error || null,
      } as Prisma.InputJsonValue,
    },
  });

  // 10. Update transaction timeline if linked
  if (transactionId && dispatchResult.success) {
    await prisma.transactionTimelineEvent.create({
      data: {
        transactionId,
        eventType: "OUTBOUND_MESSAGE_SENT",
        title: `Outbound ${messageType} Dispatched`,
        description: `Sent via ${platform} to ${recipientId}`,
        actor: TimelineActor.SELLER,
        visibility: TimelineVisibility.INTERNAL_ONLY,
      },
    }).catch(() => {});
  }

  logSocialEvent("OUTBOUND_MESSAGE", {
    businessId,
    conversationId,
    platform,
    messageType,
    status,
    messageId: created.id,
  });

  return {
    success: !!isSuccess,
    status,
    messageId: dispatchResult.messageId || created.id,
    content: text,
    error: dispatchResult.error,
    platform,
    recipientId,
    timestamp: new Date(),
  };
}
