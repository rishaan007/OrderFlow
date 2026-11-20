import { prisma } from "@/lib/prisma";
import {
  SocialPlatform,
  SocialEventType,
  EventProcessingStatus,
  ConversationChannel,
  MessageSenderType,
  MessageType,
  Prisma,
} from "@prisma/client";
import { NormalizedSocialMessage } from "@/lib/providers/types";

// Maximum allowable payload size (1 MB)
export const MAX_WEBHOOK_PAYLOAD_BYTES = 1048576;

// Replay attack window (15 minutes in milliseconds)
export const MAX_REPLAY_WINDOW_MS = 15 * 60 * 1000;

export interface IngestEventOptions {
  provider: SocialPlatform;
  externalEventId: string;
  eventType?: SocialEventType;
  externalAccountId?: string;
  externalConversationId?: string;
  externalMessageId?: string;
  externalUserId?: string;
  occurredAt?: Date;
  payload?: Record<string, unknown>;
  businessId?: string;
}

export interface IngestEventResult {
  isDuplicate: boolean;
  event: any;
  error?: string;
}

/**
 * Structured observability logger for social events
 */
export function logSocialEvent(
  stage:
    | "WEBHOOK_RECEIVED"
    | "WEBHOOK_VERIFIED"
    | "WEBHOOK_REJECTED"
    | "EVENT_PROCESSED"
    | "EVENT_DUPLICATED"
    | "EVENT_FAILED"
    | "OUTBOUND_MESSAGE"
    | "RATE_LIMITED",
  details: Record<string, unknown>
) {
  // Sanitize any accidental credentials or tokens before logging
  const sanitized = { ...details };
  delete sanitized.accessToken;
  delete sanitized.token;
  delete sanitized.secret;
  delete sanitized.signature;

  console.info(`[SOCIAL_EVENT_AUDIT] [${stage}]`, JSON.stringify(sanitized));
}

/**
 * Validates payload size to protect against oversized payload Denial of Service
 */
export function validatePayloadSize(rawPayload: string): boolean {
  return Buffer.byteLength(rawPayload, "utf8") <= MAX_WEBHOOK_PAYLOAD_BYTES;
}

/**
 * Validates timestamp freshness to protect against replay attacks
 */
export function validateReplayWindow(occurredAt: Date | number): boolean {
  const timestamp =
    typeof occurredAt === "number" ? occurredAt : occurredAt.getTime();
  const now = Date.now();

  // If timestamp is more than 15 minutes in the past or 5 minutes in the future, reject
  if (now - timestamp > MAX_REPLAY_WINDOW_MS) return false;
  if (timestamp - now > 5 * 60 * 1000) return false;
  return true;
}

/**
 * Atomically records an incoming event and checks for duplicates using database uniqueness constraints
 */
export async function recordAndDeduplicateEvent(
  options: IngestEventOptions
): Promise<IngestEventResult> {
  const {
    provider,
    externalEventId,
    eventType = SocialEventType.MESSAGE_RECEIVED,
    externalAccountId,
    externalConversationId,
    externalMessageId,
    externalUserId,
    occurredAt = new Date(),
    payload,
    businessId,
  } = options;

  try {
    const event = await prisma.socialEvent.create({
      data: {
        provider,
        externalEventId,
        eventType,
        externalAccountId,
        externalConversationId,
        externalMessageId,
        externalUserId,
        occurredAt,
        status: EventProcessingStatus.RECEIVED,
        payload: payload ? (payload as Prisma.InputJsonValue) : Prisma.JsonNull,
        businessId: businessId || null,
      },
    });

    logSocialEvent("WEBHOOK_RECEIVED", {
      provider,
      externalEventId,
      eventType,
      businessId,
    });

    return { isDuplicate: false, event };
  } catch (error: any) {
    // Unique constraint violation on [provider, externalEventId]
    if (error.code === "P2002") {
      logSocialEvent("EVENT_DUPLICATED", {
        provider,
        externalEventId,
        reason: "Duplicate event ID ignored idempotently",
      });

      const existing = await prisma.socialEvent.findUnique({
        where: {
          provider_externalEventId: {
            provider,
            externalEventId,
          },
        },
      });

      return { isDuplicate: true, event: existing };
    }

    throw error;
  }
}

/**
 * Resolves the authenticated business/tenant strictly without cross-tenant fallback
 */
export async function resolveTenantForInbound(
  platform: SocialPlatform,
  accountIdentifier: string
): Promise<string | null> {
  if (!accountIdentifier) return null;

  // 1. Look up active SocialConnection
  const connection = await prisma.socialConnection.findFirst({
    where: {
      platform,
      accountIdentifier,
    },
    select: { businessId: true },
  });

  if (connection) {
    return connection.businessId;
  }

  // 2. Fall back to BusinessProfile configured identifier
  if (platform === SocialPlatform.INSTAGRAM) {
    const profile = await prisma.businessProfile.findFirst({
      where: {
        OR: [
          { instagramPageId: accountIdentifier },
          { instagramHandle: accountIdentifier },
        ],
      },
      select: { businessId: true },
    });
    if (profile) return profile.businessId;
  }

  if (platform === SocialPlatform.WHATSAPP) {
    const profile = await prisma.businessProfile.findFirst({
      where: {
        whatsappNumber: { contains: accountIdentifier.slice(-10) },
      },
      select: { businessId: true },
    });
    if (profile) return profile.businessId;
  }

  return null;
}

/**
 * Ingests a normalized social message into the conversation thread with idempotency and tenant isolation
 */
export async function processNormalizedInboundMessage(options: {
  businessId: string;
  message: NormalizedSocialMessage;
  eventId?: string;
}) {
  const { businessId, message, eventId } = options;

  // Map SocialPlatform to ConversationChannel
  const channelMap: Record<SocialPlatform, ConversationChannel> = {
    [SocialPlatform.INSTAGRAM]: ConversationChannel.INSTAGRAM,
    [SocialPlatform.WHATSAPP]: ConversationChannel.WHATSAPP,
    [SocialPlatform.FACEBOOK]: ConversationChannel.FACEBOOK,
    [SocialPlatform.X]: ConversationChannel.X,
    [SocialPlatform.MANUAL]: ConversationChannel.MANUAL,
    [SocialPlatform.OTHER]: ConversationChannel.OTHER,
    [SocialPlatform.TIKTOK]: ConversationChannel.OTHER,
    [SocialPlatform.TELEGRAM]: ConversationChannel.OTHER,
  };

  const channel = channelMap[message.platform] || ConversationChannel.OTHER;

  // Check if a message with this external ID already exists anywhere in this business
  if (message.externalMessageId) {
    const existingMsg = await prisma.message.findFirst({
      where: {
        externalMessageId: message.externalMessageId,
        conversation: { businessId },
      },
    });

    if (existingMsg) {
      logSocialEvent("EVENT_DUPLICATED", {
        externalMessageId: message.externalMessageId,
        businessId,
        reason: "Message with identical external ID already exists in tenant",
      });

      if (eventId) {
        await prisma.socialEvent.update({
          where: { id: eventId },
          data: {
            status: EventProcessingStatus.DUPLICATE,
            processedAt: new Date(),
          },
        });
      }

      return { isDuplicate: true, messageId: existingMsg.id };
    }
  }

  // Find or create conversation for this contact and channel
  let conversation = await prisma.conversation.findFirst({
    where: {
      businessId,
      channel,
      OR: [
        { externalChatId: message.externalSenderId },
        { contactIdentifier: message.externalSenderId },
      ],
    },
  });

  const contactName =
    message.senderName ||
    (message.platform === SocialPlatform.INSTAGRAM
      ? `@ig_${message.externalSenderId.slice(-4)}`
      : message.platform === SocialPlatform.WHATSAPP
      ? `+${message.externalSenderId}`
      : message.platform === SocialPlatform.FACEBOOK
      ? `FB User (${message.externalSenderId.slice(-4)})`
      : `@${message.externalSenderId}`);

  if (!conversation) {
    // Attempt to link to existing customer by platform-specific identifier
    let customer = null;
    if (message.platform === SocialPlatform.WHATSAPP) {
      customer = await prisma.customer.findFirst({
        where: {
          businessId,
          phone: { contains: message.externalSenderId.slice(-8) },
        },
      });
    } else if (message.platform === SocialPlatform.INSTAGRAM) {
      customer = await prisma.customer.findFirst({
        where: {
          businessId,
          instagramHandle: { not: null },
        },
      });
    }

    conversation = await prisma.conversation.create({
      data: {
        businessId,
        channel,
        contactIdentifier: message.externalSenderId,
        contactName,
        customerId: customer?.id || null,
        externalChatId: message.externalSenderId,
        lastMessageAt: message.timestamp,
        lastMessageSnippet: message.content.slice(0, 120),
        unreadCount: 1,
      },
    });
  } else {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: message.timestamp,
        lastMessageSnippet: message.content.slice(0, 120),
        unreadCount: { increment: 1 },
        ...(message.senderName && !conversation.contactName
          ? { contactName: message.senderName }
          : {}),
      },
    });
  }

  // Create message
  const createdMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: MessageSenderType.CUSTOMER,
      senderName: conversation.contactName || contactName,
      content:
        message.content ||
        (message.mediaUrl ? "[Media attachment]" : "[Social Message]"),
      mediaUrl: message.mediaUrl || null,
      mediaType: message.mediaType || null,
      messageType: message.mediaUrl ? MessageType.IMAGE : MessageType.TEXT,
      externalMessageId: message.externalMessageId,
      createdAt: message.timestamp,
    },
  });

  // Mark event as PROCESSED
  if (eventId) {
    await prisma.socialEvent.update({
      where: { id: eventId },
      data: {
        status: EventProcessingStatus.PROCESSED,
        processedAt: new Date(),
        businessId,
        externalConversationId: conversation.id,
        externalMessageId: createdMessage.id,
      },
    });
  }

  logSocialEvent("EVENT_PROCESSED", {
    businessId,
    conversationId: conversation.id,
    messageId: createdMessage.id,
    channel,
  });

  return {
    isDuplicate: false,
    conversationId: conversation.id,
    messageId: createdMessage.id,
  };
}
