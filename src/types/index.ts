import {
  MemberRole,
  OrderSource,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  ConversationChannel,
  ConversationStatus,
  MessageSenderType,
  MessageType,
  PaymentMethod,
  PaymentRecordStatus,
  DeliveryPartner,
  ShipmentStatus,
  AutomationJobType,
  JobStatus,
  NotificationStatus,
  SocialPlatform,
  SocialSurface,
  TransactionStatus,
  TimelineVisibility,
  TimelineActor,
  EvidenceType,
  EvidenceVerificationState,
  DisputeStatus,
  ChannelSyncStatus,
  ConnectionStatus,
  ConnectionHealthStatus,
  SocialEventType,
  EventProcessingStatus,
} from "@prisma/client";

export {
  MemberRole,
  OrderSource,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  ConversationChannel,
  ConversationStatus,
  MessageSenderType,
  MessageType,
  PaymentMethod,
  PaymentRecordStatus,
  DeliveryPartner,
  ShipmentStatus,
  AutomationJobType,
  JobStatus,
  NotificationStatus,
  SocialPlatform,
  SocialSurface,
  TransactionStatus,
  TimelineVisibility,
  TimelineActor,
  EvidenceType,
  EvidenceVerificationState,
  DisputeStatus,
  ChannelSyncStatus,
  ConnectionStatus,
  ConnectionHealthStatus,
  SocialEventType,
  EventProcessingStatus,
};

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  systemRole: string;
}

export interface ActiveBusinessContext {
  businessId: string;
  businessName: string;
  businessSlug: string;
  role: MemberRole;
  currency: string;
  timezone: string;
}

export interface AuthSession {
  user: SessionUser;
  activeBusiness?: ActiveBusinessContext | null;
  businesses: {
    id: string;
    name: string;
    slug: string;
    role: MemberRole;
  }[];
}

export interface BusinessProfileData {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  logoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  instagramHandle?: string | null;
  whatsappNumber?: string | null;
  taxId?: string | null;
  bankDetails?: string | null;
  orderPrefix: string;
  autoConfirmOrders: boolean;
  role: MemberRole;
}

export interface DashboardStatsResponse {
  metrics: {
    totalRevenue: {
      value: number;
      formatted: string;
      changePercentage: number;
    };
    totalOrders: {
      value: number;
      changePercentage: number;
    };
    pendingReview: {
      value: number;
      description: string;
    };
    activeCustomers: {
      value: number;
      changePercentage: number;
    };
  };
  recentOrders: {
    id: string;
    orderNumber: string;
    customerName: string;
    customerContact?: string | null;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    source: OrderSource;
    totalAmount: number;
    formattedAmount: string;
    createdAt: string;
    requiresApproval: boolean;
    trackingToken?: string | null;
    platform?: string | null;
    surface?: string | null;
  }[];
  businessInfo: {
    name: string;
    slug: string;
    currency: string;
    isFullyConfigured: boolean;
  };
  socialCommerce?: {
    platformBreakdown: Record<string, { count: number; revenue: number; completedCount: number }>;
    totalTransactions: number;
  };
  attentionRequired?: {
    pendingPaymentVerifications: number;
    openDisputes: number;
    lowStockItems: number;
  };
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface ProductVariantItem {
  id: string;
  productId: string;
  title: string;
  sku?: string | null;
  price: number;
  costPrice?: number | null;
  stockQuantity: number;
}

export interface ProductItem {
  id: string;
  businessId: string;
  title: string;
  sku?: string | null;
  category?: string | null;
  description?: string | null;
  price: number;
  costPrice?: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  status: ProductStatus;
  variants: ProductVariantItem[];
  isLowStock?: boolean;
  isOutOfStock?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerItem {
  id: string;
  businessId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  instagramHandle?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  tags: string[];
  totalSpent: number;
  ordersCount: number;
  createdAt: string;
  updatedAt: string;
  orders?: OrderItemSummary[];
}

export interface OrderItemDetail {
  id: string;
  orderId: string;
  productId?: string | null;
  variantId?: string | null;
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface OrderItemSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  source: OrderSource;
  currency: string;
  subtotal: number;
  discount: number;
  discountType?: string | null;
  shipping: number;
  tax: number;
  totalAmount: number;
  amountPaid?: number;
  outstandingBalance?: number;
  stockDeducted: boolean;
  notes?: string | null;
  customerNotes?: string | null;
  requiresApproval: boolean;
  shippingAddress?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    instagramHandle?: string | null;
  } | null;
  items: OrderItemDetail[];
  payments?: PaymentItem[];
  shipments?: ShipmentItem[];
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
}

// -------------------------------------------------------------
// Phase 3: Unified Inbox & Conversation-to-Order Types
// -------------------------------------------------------------

export interface MessageItem {
  id: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderName?: string | null;
  content: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  messageType: MessageType;
  externalMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConversationItem {
  id: string;
  businessId: string;
  customerId?: string | null;
  channel: ConversationChannel;
  status: ConversationStatus;
  externalChatId?: string | null;
  contactIdentifier: string;
  contactName?: string | null;
  lastMessageAt: string;
  lastMessageSnippet?: string | null;
  unreadCount: number;
  internalNotes?: string | null;
  extractedOrderData?: ExtractedOrder | null;
  createdAt: string;
  updatedAt: string;
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    instagramHandle?: string | null;
    address?: string | null;
    city?: string | null;
    ordersCount: number;
    totalSpent: number;
  } | null;
  messages?: MessageItem[];
  orders?: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    totalAmount: number;
    createdAt: string;
  }[];
}

export interface ExtractedOrderItem {
  productId?: string | null;
  variantId?: string | null;
  title: string;
  variantTitle?: string | null;
  quantity: number;
  unitPrice: number;
  confidence: number;
  inStock: boolean;
  availableStock?: number;
  rawText?: string;
}

export interface ExtractedOrder {
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  instagramHandle?: string | null;
  shippingAddress?: string | null;
  city?: string | null;
  items: ExtractedOrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  totalAmount: number;
  notes?: string | null;
  paymentMentioned?: string | null;
  hasPaymentProof: boolean;
  missingInformation: string[];
  isComplete: boolean;
  duplicateWarning?: {
    isDuplicate: boolean;
    existingOrderId?: string;
    existingOrderNumber?: string;
    message: string;
  } | null;
}

export interface CreateManualConversationInput {
  channel: ConversationChannel;
  contactIdentifier: string;
  contactName?: string | null;
  customerId?: string | null;
  initialMessage: string;
  senderType?: MessageSenderType;
}

export interface SendMessageInput {
  content: string;
  senderType?: MessageSenderType;
  messageType?: MessageType;
  mediaUrl?: string | null;
}

// -------------------------------------------------------------
// Phase 4: Payment, Delivery & Business Automation Types
// -------------------------------------------------------------

export interface PaymentItem {
  id: string;
  businessId: string;
  orderId: string;
  customerId?: string | null;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentRecordStatus;
  referenceNumber?: string | null;
  screenshotUrl?: string | null;
  notes?: string | null;
  rejectionReason?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  order?: {
    orderNumber: string;
    totalAmount: number;
    amountPaid: number;
  };
  customer?: {
    name: string;
    phone?: string | null;
  } | null;
}

export interface ShipmentItem {
  id: string;
  businessId: string;
  orderId: string;
  carrier: DeliveryPartner;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  status: ShipmentStatus;
  shippingAddress: string;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  deliveryCharges: number;
  estimatedDelivery?: string | null;
  actualDelivery?: string | null;
  failureReason?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  order?: {
    orderNumber: string;
    status: OrderStatus;
    customer?: {
      name: string;
      phone?: string | null;
    } | null;
  };
}

export interface AutomationJobItem {
  id: string;
  businessId: string;
  type: AutomationJobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  scheduledFor: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  businessId: string;
  orderId?: string | null;
  customerId?: string | null;
  channel: string;
  recipient: string;
  title: string;
  content: string;
  status: NotificationStatus;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordPaymentInput {
  amount: number;
  method: PaymentMethod;
  referenceNumber?: string | null;
  screenshotUrl?: string | null;
  notes?: string | null;
  verifiedImmediately?: boolean; // Only if seller explicitly verifies upon entry
}

export interface VerifyPaymentInput {
  action: "VERIFY" | "REJECT";
  rejectionReason?: string | null;
  notes?: string | null;
}

export interface CreateShipmentInput {
  carrier: DeliveryPartner;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shippingAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  deliveryCharges?: number;
  estimatedDelivery?: string | null;
  notes?: string | null;
  status?: ShipmentStatus;
}

export interface UpdateShipmentStatusInput {
  status: ShipmentStatus;
  failureReason?: string | null;
  notes?: string | null;
}

// ==========================================
// Social Commerce & Transaction OS Types
// ==========================================

export interface TransactionTimelineEventItem {
  id: string;
  transactionId: string;
  eventType: string;
  title: string;
  description?: string | null;
  actor: TimelineActor;
  visibility: TimelineVisibility;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface TransactionEvidenceItem {
  id: string;
  transactionId: string;
  evidenceType: EvidenceType;
  verificationState: EvidenceVerificationState;
  source: string;
  actor: TimelineActor;
  mediaUrl?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface TransactionDisputeItem {
  id: string;
  transactionId: string;
  orderId?: string | null;
  businessId: string;
  reason: string;
  status: DisputeStatus;
  refundAmount?: number | null;
  buyerNotes?: string | null;
  sellerResponse?: string | null;
  resolutionNotes?: string | null;
  evidenceUrls: string[];
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductChannelListingItem {
  id: string;
  productId: string;
  businessId: string;
  platform: SocialPlatform;
  externalListingId?: string | null;
  platformTitle?: string | null;
  platformPrice?: number | null;
  syncStatus: ChannelSyncStatus;
  lastSyncAt?: string | null;
  syncError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialTransactionResponse {
  id: string;
  businessId: string;
  orderId?: string | null;
  customerId?: string | null;
  conversationId?: string | null;
  platform: SocialPlatform;
  surface: SocialSurface;
  status: TransactionStatus;
  publicTrackingToken: string;
  externalUserId?: string | null;
  externalConversationId?: string | null;
  externalListingId?: string | null;
  externalPostId?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  buyerNotes?: string | null;
  sellerNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  order?: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    totalAmount: number;
    amountPaid: number;
    currency: string;
    items: {
      id: string;
      title: string;
      variantTitle?: string | null;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }[];
    shipments: {
      id: string;
      carrier: DeliveryPartner;
      trackingNumber?: string | null;
      trackingUrl?: string | null;
      status: ShipmentStatus;
    }[];
    payments: {
      id: string;
      amount: number;
      method: PaymentMethod;
      status: PaymentRecordStatus;
      createdAt: string;
    }[];
  } | null;
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    instagramHandle?: string | null;
  } | null;
  timelineEvents?: TransactionTimelineEventItem[];
  evidence?: TransactionEvidenceItem[];
  disputes?: TransactionDisputeItem[];
}

/**
 * Public, sanitized projection safe for buyer-facing room /t/[token].
 * Strictly excludes private seller notes, margins, internal system logs.
 */
export interface PublicTransactionResponse {
  id: string;
  publicTrackingToken: string;
  platform: SocialPlatform;
  surface: SocialSurface;
  status: TransactionStatus;
  createdAt: string;
  updatedAt: string;
  seller: {
    name: string;
    slug: string;
    currency: string;
    logoUrl?: string | null;
    instagramHandle?: string | null;
    whatsappNumber?: string | null;
    metrics?: {
      completedOrdersCount: number;
      deliveryFulfillmentRate: number; // e.g. 98.5%
      verifiedPaymentRate: number;
      isVerifiedSeller: boolean;
    };
  };
  order?: {
    orderNumber: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    totalAmount: number;
    amountPaid: number;
    currency: string;
    shippingAddress?: string | null;
    items: {
      title: string;
      variantTitle?: string | null;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }[];
    payments: {
      amount: number;
      method: PaymentMethod;
      status: PaymentRecordStatus;
      createdAt: string;
    }[];
    shipment?: {
      carrier: DeliveryPartner;
      trackingNumber?: string | null;
      trackingUrl?: string | null;
      status: ShipmentStatus;
      estimatedDelivery?: string | null;
      actualDelivery?: string | null;
    } | null;
  } | null;
  timeline: {
    title: string;
    description?: string | null;
    actor: TimelineActor;
    createdAt: string;
  }[];
  evidence: {
    evidenceType: EvidenceType;
    verificationState: EvidenceVerificationState;
    mediaUrl?: string | null;
    notes?: string | null;
    createdAt: string;
  }[];
  disputes: {
    id: string;
    reason: string;
    status: DisputeStatus;
    buyerNotes?: string | null;
    sellerResponse?: string | null;
    createdAt: string;
  }[];
}

export interface IntentClassification {
  primaryIntent:
    | "BUYING_INTENT"
    | "PRODUCT_QUESTION"
    | "PRICE_QUESTION"
    | "STOCK_QUESTION"
    | "SIZE_QUESTION"
    | "DELIVERY_QUESTION"
    | "PAYMENT_SENT"
    | "ORDER_CONFIRMATION"
    | "CANCELLATION"
    | "RETURN_REQUEST"
    | "REFUND_REQUEST"
    | "COMPLAINT"
    | "SUPPORT"
    | "SPAM";
  confidence: number; // 0.0 to 1.0
  secondaryIntents?: string[];
  extractedEntities: {
    productMentions: string[];
    quantities: number[];
    deliveryLocation?: string;
    paymentReference?: string;
    phone?: string;
    address?: string;
  };
  missingFields: string[];
}

export type {
  CreateSocialTransactionInput,
  CreateTimelineEventInput,
  AddEvidenceInput,
  CreateDisputeInput,
  UpdateDisputeInput,
  UpsertChannelListingInput,
} from "@/lib/validations";
