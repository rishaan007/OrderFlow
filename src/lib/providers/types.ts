import {
  SocialPlatform,
  SocialSurface,
  ChannelSyncStatus,
  ConnectionHealthStatus,
} from "@prisma/client";

/**
 * Capability state for a social commerce provider
 */
export type CapabilityStatus =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "NOT_SUPPORTED"
  | "REQUIRES_BUSINESS_ACCOUNT"
  | "REQUIRES_APPROVAL"
  | "CONFIGURATION_REQUIRED";

/**
 * Core capability keys identified across social platforms
 */
export type CapabilityKey =
  | "MESSAGING"
  | "WEBHOOKS"
  | "CONVERSATION_READ"
  | "MESSAGE_READ"
  | "MESSAGE_SEND"
  | "USER_IDENTITY"
  | "MEDIA"
  | "PRODUCT_CONTEXT"
  | "LISTING_CONTEXT"
  | "COMMERCE"
  | "ORDER_EVENTS"
  | "ACCOUNT_INFORMATION";

export interface DetailedCapability {
  status: CapabilityStatus;
  description: string;
  notes?: string;
  requiresApproval?: boolean;
}

export interface ProviderCapabilities {
  // Legacy boolean flags for backwards compatibility
  messaging: boolean;
  productCatalogSync: boolean;
  orderStatusWebhook: boolean;
  paymentLinkGeneration: boolean;
  directCheckout: boolean;
  storyMentions: boolean;
  postComments: boolean;
  readReceipts: boolean;

  // Modern structured capability matrix
  matrix: Record<CapabilityKey, DetailedCapability>;
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

export interface OAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  clientId?: string;
  scopes: string[];
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  expiresAt?: Date;
  scopes?: string[];
  accountIdentifier?: string;
  accountName?: string;
}

export interface ProviderAccountInfo {
  id: string;
  name: string;
  username?: string;
  avatarUrl?: string;
  platform: SocialPlatform;
  isVerified?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ConnectionHealthCheckResult {
  status: ConnectionHealthStatus;
  lastVerifiedAt: Date;
  latencyMs?: number;
  errorMessage?: string;
  reconnectRequired?: boolean;
}

export interface SocialCommerceProvider {
  readonly platform: SocialPlatform;

  // Capabilities
  getCapabilities(): ProviderCapabilities;
  getDetailedCapabilities(): Record<CapabilityKey, DetailedCapability>;
  getCapability(key: CapabilityKey): CapabilityStatus;
  isSurfaceSupported(surface: SocialSurface): boolean;

  // Webhooks
  verifyWebhook(
    payload: string,
    signature: string | null,
    secret?: string | null
  ): boolean;
  parseIncomingWebhook(
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<NormalizedSocialMessage | null>;

  // Messaging
  sendDirectMessage(
    recipientId: string,
    message: { text: string; mediaUrl?: string },
    credentials?: { accessToken?: string; phoneNumberId?: string }
  ): Promise<SendMessageResult>;

  // Catalog Synchronization
  syncProductCatalog(
    product: {
      id: string;
      title: string;
      price: number;
      description?: string | null;
      stockQuantity: number;
    },
    action: "UPSERT" | "DELETE",
    catalogIdOverride?: string
  ): Promise<CatalogSyncResult>;

  // OAuth & Account (where officially supported)
  getAuthorizationUrl?(state: string, redirectUri: string): string;
  exchangeCodeForTokens?(code: string, redirectUri: string): Promise<TokenSet>;
  refreshToken?(refreshToken: string): Promise<TokenSet>;
  getAccountInfo?(accessToken: string): Promise<ProviderAccountInfo>;
  checkHealth?(credentials: {
    accessToken?: string;
    accountId?: string;
    phoneNumberId?: string;
  }): Promise<ConnectionHealthCheckResult>;
  disconnect?(accessToken: string): Promise<void>;
}
