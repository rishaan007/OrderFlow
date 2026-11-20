import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/integrations/whatsapp";
import { getSocialProvider } from "@/lib/providers/registry";
import {
  validatePayloadSize,
  validateReplayWindow,
  recordAndDeduplicateEvent,
  resolveTenantForInbound,
  processNormalizedInboundMessage,
  logSocialEvent,
} from "@/lib/social-events";
import { SocialPlatform } from "@prisma/client";

/**
 * Webhook Verification Handler (Facebook Messenger Platform Verification)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken =
    process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || "orderflow_verify_token_2025";

  if (mode === "subscribe" && token === expectedToken) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * Webhook Event Consumer (Incoming Facebook Messenger Messages)
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // 1. Oversized payload defense
    if (!validatePayloadSize(rawBody)) {
      logSocialEvent("WEBHOOK_REJECTED", {
        reason: "Facebook payload exceeded 1MB limit",
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
        reason: "Invalid Facebook HMAC SHA-256 signature",
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const provider = getSocialProvider(SocialPlatform.FACEBOOK);
    const normalized = await provider.parseIncomingWebhook(payload);

    if (!normalized) {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const msgTimestamp = normalized.timestamp.getTime();

    // 3. Replay attack window validation
    if (!validateReplayWindow(msgTimestamp)) {
      logSocialEvent("WEBHOOK_REJECTED", {
        messageId: normalized.externalMessageId,
        reason: "Facebook event timestamp outside valid replay window",
      });
      return NextResponse.json({ status: "replay_rejected" }, { status: 200 });
    }

    const recipientPageId = (payload as any)?.entry?.[0]?.id;

    // 4. Deduplicate event
    const dedupResult = await recordAndDeduplicateEvent({
      provider: SocialPlatform.FACEBOOK,
      externalEventId: normalized.externalMessageId,
      externalAccountId: recipientPageId,
      externalUserId: normalized.externalSenderId,
      occurredAt: normalized.timestamp,
      payload: {
        senderId: normalized.externalSenderId,
        text: normalized.content,
      },
    });

    if (dedupResult.isDuplicate) {
      return NextResponse.json({
        status: "success",
        processed: 0,
        duplicates: 1,
      });
    }

    // 5. Strict Tenant Resolution
    const businessId = await resolveTenantForInbound(
      SocialPlatform.FACEBOOK,
      recipientPageId || ""
    );

    if (!businessId) {
      logSocialEvent("WEBHOOK_REJECTED", {
        recipientPageId,
        reason: "No registered business matches Facebook Page ID",
      });
      return NextResponse.json({ status: "unmatched_tenant" }, { status: 200 });
    }

    // 6. Ingest normalized message
    await processNormalizedInboundMessage({
      businessId,
      eventId: dedupResult.event.id,
      message: normalized,
    });

    return NextResponse.json({
      status: "success",
      processed: 1,
      duplicates: 0,
    });
  } catch (error: any) {
    console.error("Facebook webhook error:", error);
    return NextResponse.json(
      { status: "processed_with_errors", error: error.message },
      { status: 200 }
    );
  }
}
