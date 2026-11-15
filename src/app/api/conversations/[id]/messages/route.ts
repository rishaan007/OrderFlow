import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getTenantDb, TenantAccessError } from "@/lib/tenant";
import { sendMessageSchema } from "@/lib/validations";
import { sendWhatsAppMessage } from "@/lib/integrations/whatsapp";
import { sendInstagramMessage } from "@/lib/integrations/instagram";
import { ConversationChannel, MessageSenderType } from "@prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const validation = sendMessageSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const tenantDb = getTenantDb(session.activeBusiness.businessId);
    const conversation = await tenantDb.getConversationById(params.id);
    if (!conversation) {
      return NextResponse.json(
        { success: false, error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Add message to internal database
    const message = await tenantDb.addMessage(params.id, {
      content: validation.data.content,
      senderType: validation.data.senderType,
      senderName: session.user.name || "Merchant",
      messageType: validation.data.messageType,
      mediaUrl: validation.data.mediaUrl,
    });

    // If outbound seller message on WhatsApp/Instagram, attempt official Meta API dispatch
    if (validation.data.senderType === MessageSenderType.SELLER) {
      const business = await tenantDb.getBusiness();
      const profile = business?.profile;

      if (conversation.channel === ConversationChannel.WHATSAPP && conversation.contactIdentifier) {
        await sendWhatsAppMessage({
          phoneNumberId: profile?.whatsappPhoneNumberId,
          accessToken: profile?.whatsappAccessToken,
          to: conversation.contactIdentifier,
          text: validation.data.content,
        });
      } else if (
        conversation.channel === ConversationChannel.INSTAGRAM &&
        conversation.externalChatId
      ) {
        await sendInstagramMessage({
          pageAccessToken: profile?.instagramAccessToken,
          recipientId: conversation.externalChatId,
          text: validation.data.content,
        });
      }
    }

    return NextResponse.json({ success: true, data: message }, { status: 201 });
  } catch (error) {
    if (error instanceof TenantAccessError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 });
    }
    console.error("POST /api/conversations/[id]/messages error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to post message" },
      { status: 500 }
    );
  }
}
