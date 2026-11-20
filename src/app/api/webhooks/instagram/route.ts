import { NextRequest, NextResponse } from "next/server";
import {
  parseInstagramWebhook,
  verifyInstagramWebhookSubscription,
} from "@/lib/integrations/instagram";
import { verifyMetaSignature } from "@/lib/integrations/whatsapp";
import {
  validatePayloadSize,
  validateReplayWindow,
  recordAndDeduplicateEvent,
  resolveTenantForInbound,
  processNormalizedInboundMessage,
  logSocialEvent,
} from "@/lib/social-events";
import { SocialPlatform, SocialSurface } from "@prisma/client";

/**
 * Webhook Verification Handler (Instagram Messaging Graph API Verification)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken =
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "orderflow_verify_token_2025";
  const verified = verifyInstagramWebhookSubscription(
    mode,
    token,
    challenge,
    expectedToken
  );

  if (verified) {
    return new Response(verified, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * Webhook Event Consumer (Incoming Instagram DMs & Story Replies)
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // 1. Oversized payload defense
    if (!validatePayloadSize(rawBody)) {
      logSocialEvent("WEBHOOK_REJECTED", {
        reason: "Payload exceeded size limit (1MB)",
      });
      return NextResponse.json(
        { error: "Payload too large" },
        { status: 413 }
      );
    }

    const signature = request.headers.get("x-hub-signature-256");
    const appSecret = process.env.META_APP_SECRET;

    // 2. Cryptographic signature verification
    if (appSecret && !verifyMetaSignature(rawBody, signature, appSecret)) {
      logSocialEvent("WEBHOOK_REJECTED", {
        reason: "Invalid HMAC SHA-256 signature",
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const messages = parseInstagramWebhook(payload);

    if (messages.length === 0) {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    let processedCount = 0;
    let duplicateCount = 0;

    for (const msg of messages) {
      const msgTimestamp = parseInt(msg.timestamp, 10) || Date.now();

      // 3. Replay attack window validation (15 minutes)
      if (!validateReplayWindow(msgTimestamp)) {
        logSocialEvent("WEBHOOK_REJECTED", {
          messageId: msg.messageId,
          reason: "Event timestamp outside valid 15-minute replay window",
        });
        continue;
      }

      // 4. Atomic Deduplication via SocialEvent unique constraint
      const dedupResult = await recordAndDeduplicateEvent({
        provider: SocialPlatform.INSTAGRAM,
        externalEventId: msg.messageId,
        externalAccountId: msg.recipientId,
        externalUserId: msg.senderId,
        occurredAt: new Date(msgTimestamp),
        payload: {
          text: msg.text,
          recipientId: msg.recipientId,
          senderId: msg.senderId,
        },
      });

      if (dedupResult.isDuplicate) {
        duplicateCount++;
        continue;
      }

      // 5. Strict Tenant Resolution (No cross-tenant leaks)
      const businessId = await resolveTenantForInbound(
        SocialPlatform.INSTAGRAM,
        msg.recipientId
      );

      if (!businessId) {
        logSocialEvent("WEBHOOK_REJECTED", {
          messageId: msg.messageId,
          recipientId: msg.recipientId,
          reason: "No registered business matches destination account ID",
        });
        continue;
      }

      // 6. Ingest normalized message into conversation thread
      const mediaUrl = msg.attachments?.[0]?.url;
      const mediaType =
        msg.attachments?.[0]?.type === "image" ? ("image" as const) : undefined;

      await processNormalizedInboundMessage({
        businessId,
        eventId: dedupResult.event.id,
        message: {
          externalMessageId: msg.messageId,
          externalSenderId: msg.senderId,
          platform: SocialPlatform.INSTAGRAM,
          surface: SocialSurface.DM,
          content: msg.text || "",
          mediaUrl,
          mediaType,
          timestamp: new Date(msgTimestamp),
        },
      });

      processedCount++;
    }

    return NextResponse.json({
      status: "success",
      processed: processedCount,
      duplicates: duplicateCount,
    });
  } catch (error: any) {
    console.error("Instagram webhook processing error:", error);
    return NextResponse.json(
      { status: "processed_with_errors", error: error.message },
      { status: 200 }
    );
  }
}
