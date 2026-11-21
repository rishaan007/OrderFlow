import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSocialProvider } from "@/lib/providers/registry";
import {
  validatePayloadSize,
  validateReplayWindow,
  recordAndDeduplicateEvent,
  resolveTenantForInbound,
  processNormalizedInboundMessage,
  logSocialEvent,
} from "@/lib/social-events";
import { SocialPlatform, ConversationChannel } from "@prisma/client";

/**
 * X Account Activity API CRC (Challenge-Response Check) Verification Handler
 * X sends GET with ?crc_token=<token>
 * Returns JSON { response_token: "sha256=<base64_hmac>" }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const crcToken = searchParams.get("crc_token");

  if (!crcToken) {
    return NextResponse.json(
      { error: "crc_token parameter is required" },
      { status: 400 }
    );
  }

  const consumerSecret =
    process.env.X_CONSUMER_SECRET || "orderflow_x_consumer_secret_2025";

  const hmac = crypto
    .createHmac("sha256", consumerSecret)
    .update(crcToken, "utf8")
    .digest("base64");

  return NextResponse.json(
    { response_token: `sha256=${hmac}` },
    { status: 200 }
  );
}

/**
 * X Account Activity API Webhook Event Consumer (Incoming DMs and Mentions)
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // 1. Oversized payload defense
    if (!validatePayloadSize(rawBody)) {
      logSocialEvent("WEBHOOK_REJECTED", {
        reason: "X webhook payload exceeded 1MB limit",
      });
      return NextResponse.json(
        { error: "Payload too large" },
        { status: 413 }
      );
    }

    const signature = request.headers.get("x-twitter-webhooks-signature");
    const consumerSecret = process.env.X_CONSUMER_SECRET;
    const provider = getSocialProvider(SocialPlatform.X);

    // 2. Cryptographic signature verification
    if (consumerSecret && !provider.verifyWebhook(rawBody, signature, consumerSecret)) {
      logSocialEvent("WEBHOOK_REJECTED", {
        reason: "Invalid X HMAC SHA-256 signature",
      });
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const normalized = await provider.parseIncomingWebhook(payload);

    if (!normalized) {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    const msgTimestamp = normalized.timestamp.getTime();

    // 3. Replay attack window validation
    if (!validateReplayWindow(msgTimestamp)) {
      logSocialEvent("WEBHOOK_REJECTED", {
        messageId: normalized.externalMessageId,
        reason: "X event timestamp outside valid replay window",
      });
      return NextResponse.json({ status: "replay_rejected" }, { status: 200 });
    }

    const forUserId = (payload as any)?.for_user_id;

    // 4. Deduplicate event
    const dedupResult = await recordAndDeduplicateEvent({
      provider: SocialPlatform.X,
      externalEventId: normalized.externalMessageId,
      externalAccountId: forUserId,
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
        message: "Duplicate X event ignored",
      });
    }

    // 5. Tenant resolution
    const tenantId = await resolveTenantForInbound(
      SocialPlatform.X,
      forUserId || normalized.externalSenderId
    );

    if (!tenantId) {
      logSocialEvent("EVENT_FAILED", {
        messageId: normalized.externalMessageId,
        reason: "No active tenant connection found for X recipient",
      });
      return NextResponse.json({
        status: "unrouted",
        reason: "No tenant connected for this X account",
      });
    }

    // 6. Ingest normalized message into conversation thread
    await processNormalizedInboundMessage({
      businessId: tenantId,
      eventId: dedupResult.event.id,
      message: normalized,
    });

    logSocialEvent("EVENT_PROCESSED", {
      provider: "X",
      tenantId,
      messageId: normalized.externalMessageId,
    });

    return NextResponse.json({
      status: "success",
      processed: 1,
      tenantId,
    });
  } catch (error: any) {
    console.error("X Webhook error:", error);
    return NextResponse.json(
      { error: "Internal processing error", message: error?.message },
      { status: 500 }
    );
  }
}
