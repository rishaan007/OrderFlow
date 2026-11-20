import { NextRequest, NextResponse } from "next/server";
import {
  parseWhatsAppWebhook,
  verifyMetaSignature,
  verifyWhatsAppWebhookSubscription,
} from "@/lib/integrations/whatsapp";
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
 * Webhook Verification Handler (Meta WhatsApp Cloud API Verification)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken =
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "orderflow_verify_token_2025";
  const verified = verifyWhatsAppWebhookSubscription(
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
 * Webhook Event Consumer (Incoming Messages & Delivery Updates)
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // 1. Oversized payload defense
    if (!validatePayloadSize(rawBody)) {
      logSocialEvent("WEBHOOK_REJECTED", {
        reason: "WhatsApp webhook payload exceeded 1MB limit",
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
        reason: "Invalid Meta HMAC SHA-256 signature for WhatsApp",
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const messages = parseWhatsAppWebhook(payload);

    if (messages.length === 0) {
      return NextResponse.json(
        { status: "ignored_or_status_update" },
        { status: 200 }
      );
    }

    let processedCount = 0;
    let duplicateCount = 0;

    for (const msg of messages) {
      const msgTimestamp =
        parseInt(msg.timestamp, 10) * 1000 || Date.now();

      // 3. Replay attack window check
      if (!validateReplayWindow(msgTimestamp)) {
        logSocialEvent("WEBHOOK_REJECTED", {
          messageId: msg.messageId,
          reason: "WhatsApp event timestamp outside replay window",
        });
        continue;
      }

      // Extract destination phone number ID from payload
      const phoneNumberId =
        payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ||
        payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.display_phone_number;

      // 4. Atomic Deduplication via SocialEvent unique constraint
      const dedupResult = await recordAndDeduplicateEvent({
        provider: SocialPlatform.WHATSAPP,
        externalEventId: msg.messageId,
        externalAccountId: phoneNumberId,
        externalUserId: msg.from,
        occurredAt: new Date(msgTimestamp),
        payload: {
          from: msg.from,
          name: msg.name,
          type: msg.type,
          text: msg.text,
        },
      });

      if (dedupResult.isDuplicate) {
        duplicateCount++;
        continue;
      }

      // 5. Strict Tenant Resolution
      const businessId = await resolveTenantForInbound(
        SocialPlatform.WHATSAPP,
        phoneNumberId || ""
      );

      if (!businessId) {
        logSocialEvent("WEBHOOK_REJECTED", {
          messageId: msg.messageId,
          phoneNumberId,
          reason: "No registered business matches recipient phone number ID",
        });
        continue;
      }

      // 6. Normalize and ingest message
      await processNormalizedInboundMessage({
        businessId,
        eventId: dedupResult.event.id,
        message: {
          externalMessageId: msg.messageId,
          externalSenderId: msg.from,
          senderName: msg.name,
          platform: SocialPlatform.WHATSAPP,
          surface: SocialSurface.DIRECT_CHAT,
          content: msg.text || "",
          mediaUrl: msg.mediaUrl,
          mediaType: msg.type === "image" ? "image" : undefined,
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
    console.error("WhatsApp webhook processing error:", error);
    return NextResponse.json(
      { status: "processed_with_errors", error: error.message },
      { status: 200 }
    );
  }
}
