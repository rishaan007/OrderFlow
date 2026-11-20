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

export class ManualProvider implements SocialCommerceProvider {
  readonly platform: SocialPlatform = SocialPlatform.MANUAL;

  getCapabilities(): ProviderCapabilities {
    return {
      messaging: false,
      productCatalogSync: false,
      orderStatusWebhook: false,
      paymentLinkGeneration: true,
      directCheckout: false,
      storyMentions: false,
      postComments: false,
      readReceipts: false,
    };
  }

  isSurfaceSupported(surface: SocialSurface): boolean {
    const supported: SocialSurface[] = [
      SocialSurface.MANUAL_ENTRY,
      SocialSurface.EXTERNAL_LINK,
      SocialSurface.OTHER,
    ];
    return supported.includes(surface);
  }

  async parseIncomingWebhook(): Promise<NormalizedSocialMessage | null> {
    // Manual channels have no automated inbound webhooks
    return null;
  }

  async sendDirectMessage(): Promise<SendMessageResult> {
    return {
      success: true,
      messageId: `manual_msg_${Date.now()}`,
      timestamp: new Date(),
    };
  }

  async syncProductCatalog(): Promise<CatalogSyncResult> {
    return {
      status: ChannelSyncStatus.MANUAL_REQUIRED,
    };
  }
}
