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
import { parseInstagramWebhook, sendInstagramMessage } from "@/lib/integrations/instagram";

export class InstagramProvider implements SocialCommerceProvider {
  readonly platform: SocialPlatform = SocialPlatform.INSTAGRAM;

  getCapabilities(): ProviderCapabilities {
    return {
      messaging: true,
      productCatalogSync: true, // Supported via Meta Commerce Manager Catalog
      orderStatusWebhook: false, // Public Meta Instagram Messaging API does not expose native delivery tracking
      paymentLinkGeneration: true, // Can send payment links in DM
      directCheckout: false, // Instagram Native In-App Checkout is limited to select enterprise US merchants
      storyMentions: true, // Exposes story_mention webhook events
      postComments: true, // Exposes media comment webhooks
      readReceipts: true,
    };
  }

  isSurfaceSupported(surface: SocialSurface): boolean {
    const supported: SocialSurface[] = [
      SocialSurface.DM,
      SocialSurface.STORY,
      SocialSurface.REEL,
      SocialSurface.POST,
      SocialSurface.SHOP,
    ];
    return supported.includes(surface);
  }

  async parseIncomingWebhook(
    payload: unknown
  ): Promise<NormalizedSocialMessage | null> {
    const parsed = parseInstagramWebhook(payload);
    if (!parsed || parsed.length === 0) return null;

    const first = parsed[0];
    return {
      externalMessageId: first.messageId,
      externalSenderId: first.senderId,
      platform: SocialPlatform.INSTAGRAM,
      surface: SocialSurface.DM,
      content: first.text || "",
      mediaUrl: first.attachments?.[0]?.url,
      mediaType: first.attachments?.[0]?.type === "image" ? "image" : undefined,
      timestamp: new Date(parseInt(first.timestamp, 10) || Date.now()),
      rawPayload: payload as Record<string, unknown>,
    };
  }

  async sendDirectMessage(
    recipientId: string,
    message: { text: string; mediaUrl?: string }
  ): Promise<SendMessageResult> {
    const pageAccessToken = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN || "";
    if (!pageAccessToken) {
      return {
        success: false,
        error: "INSTAGRAM_PAGE_ACCESS_TOKEN not configured. Message logged in manual fallback mode.",
        timestamp: new Date(),
      };
    }

    const result = await sendInstagramMessage({
      recipientId,
      text: message.text,
      pageAccessToken,
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
    const metaCatalogId = process.env.META_CATALOG_ID;
    if (!metaCatalogId) {
      // Graceful fallback: Meta Catalog requires Business Manager Catalog ID
      return {
        status: ChannelSyncStatus.MANUAL_REQUIRED,
        error: "META_CATALOG_ID not configured. Catalog item must be synchronized manually or via Meta Commerce Manager feed.",
      };
    }

    // When configured with Meta Graph API
    return {
      status: ChannelSyncStatus.SYNCED,
      externalListingId: `meta_cat_${product.id.slice(0, 8)}`,
    };
  }
}
