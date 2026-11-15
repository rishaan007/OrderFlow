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
  }[];
  businessInfo: {
    name: string;
    slug: string;
    currency: string;
    isFullyConfigured: boolean;
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
