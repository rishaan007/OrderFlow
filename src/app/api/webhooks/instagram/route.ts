import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  parseInstagramWebhook,
  verifyInstagramWebhookSubscription,
} from "@/lib/integrations/instagram";
import { verifyMetaSignature } from "@/lib/integrations/whatsapp";
import { ConversationChannel, MessageSenderType, MessageType } from "@prisma/client";

/**
 * Webhook Verification Handler (Instagram Messaging Graph API Verification)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "orderflow_verify_token_2025";
  const verified = verifyInstagramWebhookSubscription(mode, token, challenge, expectedToken);

  if (verified) {
    return new Response(verified, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * Webhook Event Consumer (Incoming Instagram DMs & Stories Replies)
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
    const messages = parseInstagramWebhook(payload);

    if (messages.length === 0) {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }

    for (const msg of messages) {
      // Find business: match by configured instagramPageId or instagramHandle, or default
      const businessProfile = await prisma.businessProfile.findFirst({
        where: {
          OR: [
            { instagramPageId: msg.recipientId },
            { instagramHandle: { not: null } },
          ],
        },
        include: { business: true },
      });

      const business = businessProfile?.business || (await prisma.business.findFirst());
      if (!business) {
        console.warn("No business found to attach Instagram webhook message");
        continue;
      }

      // Check if conversation already exists for this sender ID
      let conversation = await prisma.conversation.findFirst({
        where: {
          businessId: business.id,
          channel: ConversationChannel.INSTAGRAM,
          OR: [
            { externalChatId: msg.senderId },
            { contactIdentifier: `@ig_${msg.senderId.slice(-6)}` },
          ],
        },
      });

      const contactHandle = `@ig_user_${msg.senderId.slice(-4)}`;

      if (!conversation) {
        // Auto-link to existing customer by instagram handle if available
        const customer = await prisma.customer.findFirst({
          where: {
            businessId: business.id,
            instagramHandle: { not: null },
          },
        });

        conversation = await prisma.conversation.create({
          data: {
            businessId: business.id,
            channel: ConversationChannel.INSTAGRAM,
            contactIdentifier: contactHandle,
            contactName: `Instagram Buyer (${msg.senderId.slice(-4)})`,
            customerId: customer?.id || null,
            externalChatId: msg.senderId,
            lastMessageAt: new Date(parseInt(msg.timestamp, 10) || Date.now()),
            lastMessageSnippet: (msg.text || "").slice(0, 120),
            unreadCount: 1,
          },
        });
      } else {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: new Date(parseInt(msg.timestamp, 10) || Date.now()),
            lastMessageSnippet: (msg.text || "").slice(0, 120),
            unreadCount: { increment: 1 },
          },
        });
      }

      const mediaUrl = msg.attachments?.[0]?.url || null;
      const mediaType = msg.attachments?.[0]?.type || null;

      // Persist inbound message
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: MessageSenderType.CUSTOMER,
          senderName: conversation.contactName || contactHandle,
          content: msg.text || (mediaUrl ? "[Image / Story Reply]" : "[Instagram Message]"),
          mediaUrl,
          mediaType,
          messageType: mediaUrl ? MessageType.IMAGE : MessageType.TEXT,
          externalMessageId: msg.messageId,
          createdAt: new Date(parseInt(msg.timestamp, 10) || Date.now()),
        },
      });
    }

    return NextResponse.json({ status: "success", count: messages.length });
  } catch (error) {
    console.error("Instagram webhook error:", error);
    return NextResponse.json({ status: "processed_with_errors" }, { status: 200 });
  }
}
