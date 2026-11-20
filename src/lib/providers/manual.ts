import {
  SocialPlatform,
  SocialSurface,
  ChannelSyncStatus,
  ConnectionHealthStatus,
} from "@prisma/client";
import {
  SocialCommerceProvider,
  ProviderCapabilities,
  DetailedCapability,
  CapabilityKey,
  CapabilityStatus,
  NormalizedSocialMessage,
  SendMessageResult,
  CatalogSyncResult,
  ConnectionHealthCheckResult,
} from "./types";

export class ManualProvider implements SocialCommerceProvider {
  readonly platform: SocialPlatform = SocialPlatform.MANUAL;

  private readonly capabilitiesMatrix: Record<CapabilityKey, DetailedCapability> = {
    MESSAGING: {
      status: "NOT_SUPPORTED",
      description: "Manual channel uses local note-taking and manual order entry.",
    },
    WEBHOOKS: {
      status: "NOT_SUPPORTED",
      description: "Manual channel has no automated webhooks.",
    },
    CONVERSATION_READ: {
      status: "NOT_SUPPORTED",
      description: "Manual entries are recorded directly within OrderFlow.",
    },
    MESSAGE_READ: {
      status: "NOT_SUPPORTED",
      description: "Messages are recorded manually by staff members.",
    },
    MESSAGE_SEND: {
      status: "NOT_SUPPORTED",
      description: "Outbound messages are sent manually via seller's own devices.",
    },
    USER_IDENTITY: {
      status: "SUPPORTED",
      description: "Customer phone, email, and social handle captured manually.",
    },
    MEDIA: {
      status: "PARTIALLY_SUPPORTED",
      description: "Payment proof and order screenshots uploaded manually.",
    },
    PRODUCT_CONTEXT: {
      status: "SUPPORTED",
      description: "Direct attachment of OrderFlow catalog products.",
    },
    LISTING_CONTEXT: {
      status: "NOT_SUPPORTED",
      description: "External listing links can be saved as references.",
    },
    COMMERCE: {
      status: "NOT_SUPPORTED",
      description: "No direct platform checkout. OrderFlow tracking links (/t/[token]) provide payment flow.",
    },
    ORDER_EVENTS: {
      status: "NOT_SUPPORTED",
      description: "Carrier tracking updated manually or via shipping integrations.",
    },
    ACCOUNT_INFORMATION: {
      status: "NOT_SUPPORTED",
      description: "No external account API connection.",
    },
  };

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
      matrix: this.capabilitiesMatrix,
    };
  }

  getDetailedCapabilities(): Record<CapabilityKey, DetailedCapability> {
    return this.capabilitiesMatrix;
  }

  getCapability(key: CapabilityKey): CapabilityStatus {
    return this.capabilitiesMatrix[key]?.status || "NOT_SUPPORTED";
  }

  isSurfaceSupported(surface: SocialSurface): boolean {
    const supported: SocialSurface[] = [
      SocialSurface.MANUAL_ENTRY,
      SocialSurface.EXTERNAL_LINK,
      SocialSurface.OTHER,
    ];
    return supported.includes(surface);
  }

  verifyWebhook(): boolean {
    return false;
  }

  async parseIncomingWebhook(): Promise<NormalizedSocialMessage | null> {
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

  async checkHealth(): Promise<ConnectionHealthCheckResult> {
    return {
      status: ConnectionHealthStatus.HEALTHY,
      lastVerifiedAt: new Date(),
    };
  }
}
