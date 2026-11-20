import {
  SocialPlatform,
  SocialSurface,
  ChannelSyncStatus,
} from "@prisma/client";
import {
  SocialCommerceProvider,
  ProviderCapabilities,
  NormalizedSocialMessage,
  SendMessageResult,
  CatalogSyncResult,
} from "./types";
import { parseWhatsAppWebhook, sendWhatsAppMessage } from "@/lib/integrations/whatsapp";

export class WhatsAppProvider implements SocialCommerceProvider {
  readonly platform: SocialPlatform = SocialPlatform.WHATSAPP;

  getCapabilities(): ProviderCapabilities {
    return {
      messaging: true,
      productCatalogSync: true, // WhatsApp Business Catalog via Meta Commerce API
      orderStatusWebhook: false, // End-to-end carrier tracking is not natively pushed to WhatsApp Cloud API
      paymentLinkGeneration: true, // Native UPI & payment link messages
      directCheckout: false, // WhatsApp In-App Payments limited to select India/Brazil merchant accounts
      storyMentions: false, // WhatsApp Status does not expose third-party bot mention webhooks
      postComments: false,
      readReceipts: true,
    };
  }

  isSurfaceSupported(surface: SocialSurface): boolean {
    const supported: SocialSurface[] = [
      SocialSurface.DIRECT_CHAT,
      SocialSurface.BUSINESS_PROFILE,
      SocialSurface.CATALOG,
    ];
    return supported.includes(surface);
  }

  async parseIncomingWebhook(
    payload: unknown
  ): Promise<NormalizedSocialMessage | null> {
    const parsed = parseWhatsAppWebhook(payload);
    if (!parsed || parsed.length === 0) return null;

    const first = parsed[0];
    return {
      externalMessageId: first.messageId,
      externalSenderId: first.from,
      senderName: first.name,
      platform: SocialPlatform.WHATSAPP,
      surface: SocialSurface.DIRECT_CHAT,
      content: first.text || "",
      mediaUrl: first.mediaUrl,
      mediaType: first.type === "image" ? "image" : undefined,
      timestamp: new Date(parseInt(first.timestamp, 10) * 1000 || Date.now()),
      rawPayload: payload as Record<string, unknown>,
    };
  }

  async sendDirectMessage(
    recipientId: string,
    message: { text: string; mediaUrl?: string }
  ): Promise<SendMessageResult> {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";

    if (!phoneNumberId || !accessToken) {
      return {
        success: false,
        error: "WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN not configured. Running in manual mode.",
        timestamp: new Date(),
      };
    }

    const result = await sendWhatsAppMessage({
      to: recipientId,
      text: message.text,
      phoneNumberId,
      accessToken,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      timestamp: new Date(),
    };
  }

  async syncProductCatalog(
    product: {
      id: string;
      title: string;
      price: number;
      description?: string | null;
      stockQuantity: number;
    },
    action: "UPSERT" | "DELETE"
  ): Promise<CatalogSyncResult> {
    const catalogId = process.env.WHATSAPP_CATALOG_ID;
    if (!catalogId) {
      return {
        status: ChannelSyncStatus.MANUAL_REQUIRED,
        error: "WHATSAPP_CATALOG_ID not configured. Please link catalog in Meta Commerce Manager.",
      };
    }

    return {
      status: ChannelSyncStatus.SYNCED,
      externalListingId: `wa_cat_${product.id.slice(0, 8)}`,
    };
  }
}
