import { SocialPlatform, SocialSurface, ChannelSyncStatus } from "@prisma/client";

export interface ProviderCapabilities {
  messaging: boolean;
  productCatalogSync: boolean;
  orderStatusWebhook: boolean;
  paymentLinkGeneration: boolean;
  directCheckout: boolean;
  storyMentions: boolean;
  postComments: boolean;
  readReceipts: boolean;
}

export interface NormalizedSocialMessage {
  externalMessageId: string;
  externalSenderId: string;
  senderName?: string;
  platform: SocialPlatform;
  surface: SocialSurface;
  content: string;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video" | "document";
  timestamp: Date;
  rawPayload?: Record<string, unknown>;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
}

export interface CatalogSyncResult {
  status: ChannelSyncStatus;
  externalListingId?: string;
  error?: string;
}

export interface SocialCommerceProvider {
  readonly platform: SocialPlatform;
  getCapabilities(): ProviderCapabilities;
  isSurfaceSupported(surface: SocialSurface): boolean;
  parseIncomingWebhook(
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<NormalizedSocialMessage | null>;
  sendDirectMessage(
    recipientId: string,
    message: { text: string; mediaUrl?: string }
  ): Promise<SendMessageResult>;
  syncProductCatalog(
    product: {
      id: string;
      title: string;
      price: number;
      description?: string | null;
      stockQuantity: number;
    },
    action: "UPSERT" | "DELETE"
  ): Promise<CatalogSyncResult>;
}
