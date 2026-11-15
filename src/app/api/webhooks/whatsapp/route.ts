import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  parseWhatsAppWebhook,
  verifyMetaSignature,
  verifyWhatsAppWebhookSubscription,
} from "@/lib/integrations/whatsapp";
import { ConversationChannel, MessageSenderType, MessageType } from "@prisma/client";

/**
 * Webhook Verification Handler (Meta Developer Portal Webhook Verification)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "orderflow_verify_token_2025";
  const verified = verifyWhatsAppWebhookSubscription(mode, token, challenge, expectedToken);

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
    const signature = request.headers.get("x-hub-signature-256");
    const appSecret = process.env.META_APP_SECRET;

    // Verify signature if secret is configured
    if (appSecret && !verifyMetaSignature(rawBody, signature, appSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const messages = parseWhatsAppWebhook(payload);

    if (messages.length === 0) {
      return NextResponse.json({ status: "ignored_or_status_update" }, { status: 200 });
    }

    // Process each inbound message
    for (const msg of messages) {
      // Find business: match by configured whatsappNumber, or default to first business
      const businessProfile = await prisma.businessProfile.findFirst({
        where: {
          whatsappNumber: { not: null },
        },
        include: { business: true },
      });

      const business = businessProfile?.business || (await prisma.business.findFirst());
      if (!business) {
        console.warn("No business found to attach WhatsApp webhook message");
        continue;
      }

      // Check if conversation already exists for this sender
      let conversation = await prisma.conversation.findFirst({
        where: {
          businessId: business.id,
          channel: ConversationChannel.WHATSAPP,
          contactIdentifier: msg.from,
        },
      });

      if (!conversation) {
        // Auto-link to existing customer by phone if available
        const customer = await prisma.customer.findFirst({
          where: {
            businessId: business.id,
            phone: { contains: msg.from.slice(-8) },
          },
        });

        conversation = await prisma.conversation.create({
          data: {
            businessId: business.id,
            channel: ConversationChannel.WHATSAPP,
            contactIdentifier: msg.from,
            contactName: msg.name || `+${msg.from}`,
            customerId: customer?.id || null,
            externalChatId: msg.from,
            lastMessageAt: new Date(parseInt(msg.timestamp, 10) * 1000 || Date.now()),
            lastMessageSnippet: (msg.text || "").slice(0, 120),
            unreadCount: 1,
          },
        });
      } else {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: new Date(parseInt(msg.timestamp, 10) * 1000 || Date.now()),
            lastMessageSnippet: (msg.text || "").slice(0, 120),
            unreadCount: { increment: 1 },
            ...(msg.name && !conversation.contactName ? { contactName: msg.name } : {}),
          },
        });
      }

      // Persist inbound message
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: MessageSenderType.CUSTOMER,
          senderName: msg.name || `+${msg.from}`,
          content: msg.text || (msg.type === "image" ? "[Image attachment]" : "[Message]"),
          mediaUrl: msg.mediaUrl || null,
          mediaType: msg.mimeType || null,
          messageType: msg.type === "image" ? MessageType.IMAGE : MessageType.TEXT,
          externalMessageId: msg.messageId,
          createdAt: new Date(parseInt(msg.timestamp, 10) * 1000 || Date.now()),
        },
      });
    }

    return NextResponse.json({ status: "success", count: messages.length });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    // Meta requires 200 OK to avoid infinite retry storms on application errors
    return NextResponse.json({ status: "processed_with_errors" }, { status: 200 });
  }
}
