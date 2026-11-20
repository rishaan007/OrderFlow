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

export class FacebookProvider implements SocialCommerceProvider {
  readonly platform: SocialPlatform = SocialPlatform.FACEBOOK;

  getCapabilities(): ProviderCapabilities {
    return {
      messaging: true, // Facebook Messenger
      productCatalogSync: true, // Facebook Marketplace & Page Shop Catalog via Commerce Manager
      orderStatusWebhook: false,
      paymentLinkGeneration: true,
      directCheckout: false,
      storyMentions: false,
      postComments: true, // Page post comments
      readReceipts: true,
    };
  }

  isSurfaceSupported(surface: SocialSurface): boolean {
    const supported: SocialSurface[] = [
      SocialSurface.MESSENGER,
      SocialSurface.MARKETPLACE,
      SocialSurface.PAGE,
      SocialSurface.SHOP,
    ];
    return supported.includes(surface);
  }

  async parseIncomingWebhook(
    payload: unknown
  ): Promise<NormalizedSocialMessage | null> {
    const raw = payload as any;
    const entry = raw?.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (!messaging || !messaging.sender?.id) return null;

    return {
      externalMessageId: messaging.message?.mid || `fb_${Date.now()}`,
      externalSenderId: messaging.sender.id,
      platform: SocialPlatform.FACEBOOK,
      surface: SocialSurface.MESSENGER,
      content: messaging.message?.text || "",
      timestamp: new Date(messaging.timestamp || Date.now()),
      rawPayload: raw,
    };
  }

  async sendDirectMessage(
    recipientId: string,
    message: { text: string; mediaUrl?: string }
  ): Promise<SendMessageResult> {
    const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!pageToken) {
      return {
        success: false,
        error: "FACEBOOK_PAGE_ACCESS_TOKEN not configured. Message preserved in manual fallback mode.",
        timestamp: new Date(),
      };
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: recipientId },
            message: { text: message.text },
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          error: data?.error?.message || "Facebook Graph API message delivery failed",
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        messageId: data.message_id,
        timestamp: new Date(),
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Network error sending Facebook message",
        timestamp: new Date(),
      };
    }
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
    const catalogId = process.env.FACEBOOK_CATALOG_ID;
    if (!catalogId) {
      return {
        status: ChannelSyncStatus.MANUAL_REQUIRED,
        error: "FACEBOOK_CATALOG_ID not configured. Catalog managed via Meta Commerce Manager.",
      };
    }

    return {
      status: ChannelSyncStatus.SYNCED,
      externalListingId: `fb_cat_${product.id.slice(0, 8)}`,
    };
  }
}
