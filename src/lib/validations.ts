import { z } from "zod";

// --- Authentication Schemas ---

export const registerSchema = z.object({
  name: z.string().min(2, "Full name must be at least 2 characters").max(60),
  email: z.string().email("Please enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

// --- Business & Onboarding Schemas ---

export const businessOnboardingSchema = z.object({
  name: z.string().min(2, "Business name must be at least 2 characters").max(80),
  slug: z
    .string()
    .min(2, "Workspace URL identifier must be at least 2 characters")
    .max(50)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase alphanumeric characters and hyphens"
    ),
  currency: z.string().default("USD"),
  timezone: z.string().default("UTC"),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  instagramHandle: z.string().optional().or(z.literal("")),
  whatsappNumber: z.string().optional().or(z.literal("")),
});

export const updateBusinessProfileSchema = z.object({
  name: z.string().min(2, "Business name must be at least 2 characters").max(80),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("")),
  address: z.string().optional().nullable(),
  instagramHandle: z.string().optional().nullable(),
  whatsappNumber: z.string().optional().nullable(),
  taxId: z.string().optional().nullable(),
  bankDetails: z.string().optional().nullable(),
  orderPrefix: z.string().min(1).max(10).default("ORD-"),
});

// --- Product & Variant Schemas ---

export const productVariantInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Variant title is required"),
  sku: z.string().optional().nullable(),
  price: z.coerce.number().min(0, "Price must be non-negative"),
  costPrice: z.coerce.number().min(0).optional().nullable(),
  stockQuantity: z.coerce.number().int().min(0, "Stock must be non-negative").default(0),
});

export const createProductSchema = z.object({
  title: z.string().min(2, "Product title must be at least 2 characters").max(120),
  sku: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  price: z.coerce.number().min(0, "Base price must be a non-negative number"),
  costPrice: z.coerce.number().min(0).optional().nullable(),
  stockQuantity: z.coerce.number().int().min(0, "Stock must be non-negative").default(0),
  lowStockThreshold: z.coerce.number().int().min(0).default(5),
  trackInventory: z.boolean().default(true),
  status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).default("ACTIVE"),
  variants: z.array(productVariantInputSchema).optional(),
});

export const updateProductSchema = createProductSchema.partial();

// --- Customer CRM Schemas ---

export const createCustomerSchema = z.object({
  name: z.string().min(2, "Customer name must be at least 2 characters").max(80),
  phone: z.string().optional().nullable(),
  email: z.string().email("Invalid email address").optional().nullable().or(z.literal("")),
  instagramHandle: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
});

export const updateCustomerSchema = createCustomerSchema.partial();

// --- Order & Item Schemas ---

export const orderItemInputSchema = z.object({
  productId: z.string().optional().nullable(),
  variantId: z.string().optional().nullable(),
  title: z.string().min(1, "Item title is required"),
  variantTitle: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1"),
  unitPrice: z.coerce.number().min(0, "Unit price must be non-negative"),
});

export const createOrderSchema = z.object({
  customerId: z.string().optional().nullable(),
  newCustomer: z
    .object({
      name: z.string().min(2),
      phone: z.string().optional().nullable(),
      email: z.string().email().optional().nullable().or(z.literal("")),
      instagramHandle: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  source: z.enum(["MANUAL", "WHATSAPP", "INSTAGRAM", "ONLINE"]).default("MANUAL"),
  status: z
    .enum(["DRAFT", "PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"])
    .default("PENDING"),
  paymentStatus: z
    .enum(["PENDING", "PARTIALLY_PAID", "PAID", "REFUNDED"])
    .default("PENDING"),
  discount: z.coerce.number().min(0).default(0),
  discountType: z.enum(["FIXED", "PERCENTAGE"]).default("FIXED"),
  shipping: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  shippingAddress: z.string().optional().nullable(),
  conversationId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
  requiresApproval: z.boolean().default(false),
  items: z.array(orderItemInputSchema).min(1, "Order must contain at least one item"),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    "DRAFT",
    "PENDING",
    "CONFIRMED",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ]),
});

export const updatePaymentStatusSchema = z.object({
  paymentStatus: z.enum(["PENDING", "PARTIALLY_PAID", "PAID", "REFUNDED"]),
});

export const updateOrderSchema = createOrderSchema.partial();

// Types
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type BusinessOnboardingInput = z.infer<typeof businessOnboardingSchema>;
export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileSchema>;

export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

// --- Phase 3: Unified Inbox & Conversation Schemas ---

export const createConversationSchema = z.object({
  channel: z.enum(["WHATSAPP", "INSTAGRAM", "MANUAL"]).default("MANUAL"),
  contactIdentifier: z.string().min(1, "Contact phone, handle, or identifier is required"),
  contactName: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  initialMessage: z.string().min(1, "Initial message content is required"),
  senderType: z.enum(["CUSTOMER", "SELLER", "SYSTEM"]).default("CUSTOMER"),
});

export const updateConversationSchema = z.object({
  status: z.enum(["OPEN", "PENDING_ORDER", "ORDER_CREATED", "RESOLVED", "ARCHIVED"]).optional(),
  customerId: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1, "Message content is required"),
  senderType: z.enum(["CUSTOMER", "SELLER", "SYSTEM"]).default("SELLER"),
  messageType: z.enum(["TEXT", "IMAGE", "ORDER_INQUIRY", "PAYMENT_PROOF"]).default("TEXT"),
  mediaUrl: z.string().optional().nullable(),
});

export const extractOrderSchema = z.object({
  textOverride: z.string().optional(),
});

export const createOrderFromConversationSchema = z.object({
  customerId: z.string().optional().nullable(),
  customerName: z.string().min(1, "Customer name is required"),
  customerPhone: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable().or(z.literal("")),
  instagramHandle: z.string().optional().nullable(),
  shippingAddress: z.string().min(3, "Shipping address is required"),
  city: z.string().optional().nullable(),
  items: z.array(orderItemInputSchema).min(1, "At least one item is required"),
  discount: z.coerce.number().min(0).default(0),
  discountType: z.enum(["FIXED", "PERCENTAGE"]).default("FIXED"),
  shipping: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  notes: z.string().optional().nullable(),
  status: z.enum(["PENDING", "CONFIRMED"]).default("CONFIRMED"),
  allowDuplicate: z.boolean().default(false),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type CreateOrderFromConversationInput = z.infer<typeof createOrderFromConversationSchema>;

// --- Phase 4: Payment, Delivery & Automation Schemas ---

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive("Payment amount must be greater than zero"),
  method: z.enum(["UPI", "CASH", "BANK_TRANSFER", "CARD", "OTHER"]).default("UPI"),
  referenceNumber: z.string().optional().nullable(),
  screenshotUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  verifiedImmediately: z.boolean().default(false),
});

export const verifyPaymentSchema = z.object({
  action: z.enum(["VERIFY", "REJECT"]),
  rejectionReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const createShipmentSchema = z.object({
  carrier: z
    .enum([
      "MANUAL",
      "SHIPROCKET",
      "DELHIVERY",
      "BLUEDART",
      "PORTER",
      "DUNZO",
      "FEDEX",
      "LOCAL_COURIER",
      "OTHER",
    ])
    .default("MANUAL"),
  trackingNumber: z.string().optional().nullable(),
  trackingUrl: z.string().url().optional().nullable().or(z.literal("")),
  shippingAddress: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  deliveryCharges: z.coerce.number().min(0).default(0),
  estimatedDelivery: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z
    .enum([
      "PENDING",
      "DISPATCHED",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "FAILED_ATTEMPT",
      "RETURNED_TO_ORIGIN",
      "CANCELLED",
    ])
    .default("PENDING"),
});

export const updateShipmentStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "DISPATCHED",
    "IN_TRANSIT",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "FAILED_ATTEMPT",
    "RETURNED_TO_ORIGIN",
    "CANCELLED",
  ]),
  failureReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type UpdateShipmentStatusInput = z.infer<typeof updateShipmentStatusSchema>;

// --- Social Commerce & Transaction OS Schemas ---

export const socialPlatformEnum = z.enum([
  "INSTAGRAM",
  "FACEBOOK",
  "WHATSAPP",
  "TIKTOK",
  "TELEGRAM",
  "OTHER",
  "MANUAL",
]);

export const socialSurfaceEnum = z.enum([
  "DM",
  "POST",
  "STORY",
  "REEL",
  "SHOP",
  "MARKETPLACE",
  "MESSENGER",
  "PAGE",
  "DIRECT_CHAT",
  "BUSINESS_PROFILE",
  "CATALOG",
  "MANUAL_ENTRY",
  "EXTERNAL_LINK",
  "OTHER",
]);

export const transactionStatusEnum = z.enum([
  "INQUIRY",
  "INTENT_CONFIRMED",
  "ORDER_CREATED",
  "PAYMENT_PENDING",
  "PAYMENT_VERIFIED",
  "PROCESSING",
  "DISPATCHED",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "DISPUTED",
  "REFUNDED",
  "CANCELLED",
]);

export const createSocialTransactionSchema = z.object({
  orderId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  conversationId: z.string().optional().nullable(),
  platform: socialPlatformEnum.default("MANUAL"),
  surface: socialSurfaceEnum.default("MANUAL_ENTRY"),
  status: transactionStatusEnum.default("INQUIRY"),
  externalUserId: z.string().optional().nullable(),
  externalConversationId: z.string().optional().nullable(),
  externalListingId: z.string().optional().nullable(),
  externalPostId: z.string().optional().nullable(),
  sourceUrl: z.string().url().optional().nullable().or(z.literal("")),
  buyerNotes: z.string().optional().nullable(),
  sellerNotes: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const updateSocialTransactionSchema = createSocialTransactionSchema.partial();

export const createTimelineEventSchema = z.object({
  eventType: z.string().min(1, "Event type is required"),
  title: z.string().min(1, "Event title is required"),
  description: z.string().optional().nullable(),
  actor: z.enum(["BUYER", "SELLER", "SYSTEM", "CARRIER"]).default("SYSTEM"),
  visibility: z.enum(["PUBLIC", "INTERNAL_ONLY"]).default("PUBLIC"),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const addEvidenceSchema = z.object({
  evidenceType: z.enum([
    "ORIGINAL_MESSAGE",
    "ORDER_CONFIRMATION",
    "PAYMENT_PROOF",
    "PAYMENT_VERIFICATION",
    "SHIPMENT_CREATION",
    "CARRIER_TRACKING",
    "DELIVERY_CONFIRMATION",
    "BUYER_CONFIRMATION",
    "SELLER_CONFIRMATION",
    "RETURN_REQUEST",
    "REFUND_RECORD",
    "DISPUTE_EVIDENCE",
  ]),
  verificationState: z
    .enum([
      "OBSERVED",
      "USER_PROVIDED",
      "SELLER_CONFIRMED",
      "BUYER_CONFIRMED",
      "SYSTEM_GENERATED",
      "REJECTED",
    ])
    .default("OBSERVED"),
  source: z.string().default("MANUAL_UPLOAD"),
  actor: z.enum(["BUYER", "SELLER", "SYSTEM", "CARRIER"]).default("SYSTEM"),
  mediaUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const createDisputeSchema = z.object({
  reason: z.string().min(3, "Reason must be at least 3 characters").max(500),
  refundAmount: z.coerce.number().min(0).optional().nullable(),
  buyerNotes: z.string().optional().nullable(),
  evidenceUrls: z.array(z.string()).default([]),
});

export const updateDisputeSchema = z.object({
  status: z.enum([
    "REQUESTED",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "RETURN_IN_TRANSIT",
    "RETURN_RECEIVED",
    "REFUND_PENDING",
    "REFUNDED",
    "CLOSED",
  ]),
  sellerResponse: z.string().optional().nullable(),
  resolutionNotes: z.string().optional().nullable(),
  refundAmount: z.coerce.number().min(0).optional().nullable(),
});

export const upsertChannelListingSchema = z.object({
  productId: z.string().uuid("Valid product ID required"),
  platform: socialPlatformEnum,
  externalListingId: z.string().optional().nullable(),
  platformTitle: z.string().optional().nullable(),
  platformPrice: z.coerce.number().min(0).optional().nullable(),
  syncStatus: z
    .enum(["SYNCED", "PENDING", "FAILED", "NOT_SUPPORTED", "MANUAL_REQUIRED"])
    .default("PENDING"),
  syncError: z.string().optional().nullable(),
});

export type CreateSocialTransactionInput = z.infer<typeof createSocialTransactionSchema>;
export type CreateTimelineEventInput = z.infer<typeof createTimelineEventSchema>;
export type AddEvidenceInput = z.infer<typeof addEvidenceSchema>;
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;
export type UpdateDisputeInput = z.infer<typeof updateDisputeSchema>;
export type UpsertChannelListingInput = z.infer<typeof upsertChannelListingSchema>;

// --- Buyer OS & Experience Schemas ---

export const confirmDeliverySchema = z.object({
  recipientName: z.string().min(2, "Recipient name must be at least 2 characters").max(80),
  phone: z.string().min(6, "Valid contact phone number is required").max(25),
  email: z.string().email("Valid email required").optional().nullable().or(z.literal("")),
  shippingAddress: z.string().min(5, "Full street address is required").max(200),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const submitBuyerPaymentSchema = z.object({
  method: z
    .enum(["UPI", "CASH", "BANK_TRANSFER", "CARD", "OTHER"])
    .default("UPI"),
  amount: z.coerce.number().positive("Payment amount must be greater than zero"),
  referenceNumber: z.string().min(3, "Transaction reference or UTR is required").max(80),
  screenshotUrl: z.string().url("Valid image URL required").optional().nullable().or(z.literal("")),
  notes: z.string().optional().nullable(),
});

export const claimTransactionSchema = z.object({
  token: z.string().min(8, "Valid transaction tracking token is required"),
});

export type ConfirmDeliveryInput = z.infer<typeof confirmDeliverySchema>;
export type SubmitBuyerPaymentInput = z.infer<typeof submitBuyerPaymentSchema>;
export type ClaimTransactionInput = z.infer<typeof claimTransactionSchema>;

// ============================================================================
// Phase 3 — Buyer Identity, Linking, Verification & Claiming Schemas
// ============================================================================

export const buyerIdentityProviderEnum = z.enum([
  "ORDERFLOW_ACCOUNT",
  "INSTAGRAM",
  "WHATSAPP",
  "FACEBOOK",
  "X",
  "EMAIL",
  "PHONE",
]);

export const updateBuyerProfileSchema = z.object({
  displayName: z.string().min(1, "Display name cannot be empty").max(100).optional().nullable(),
  locale: z.string().max(10).optional().nullable(),
  timezone: z.string().max(50).optional().nullable(),
  avatarUrl: z.string().url("Valid image URL required").optional().nullable().or(z.literal("")),
  privacySettings: z
    .object({
      allowCrossSellerIdentityResolution: z.boolean().optional(),
      marketingNotifications: z.boolean().optional(),
    })
    .optional()
    .nullable(),
  notificationPreferences: z
    .object({
      transactionUpdates: z.boolean().optional(),
      promotionalUpdates: z.boolean().optional(),
    })
    .optional()
    .nullable(),
});

export const linkBuyerIdentitySchema = z.object({
  provider: buyerIdentityProviderEnum,
  externalIdentityId: z.string().min(1, "Identifier required").max(255),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const requestContactVerificationSchema = z.object({
  type: z.enum(["EMAIL", "PHONE"]),
  value: z.string().min(3, "Contact value required").max(255),
});

export const verifyContactCodeSchema = z.object({
  challengeId: z.string().min(1, "Challenge ID required"),
  code: z.string().min(4, "Verification code required").max(10),
});

export const createBuyerClaimChallengeSchema = z.object({
  token: z.string().min(8, "Transaction token required"),
});

export const consumeBuyerClaimChallengeSchema = z.object({
  challengeId: z.string().min(1, "Challenge ID required"),
  challengeToken: z.string().min(8, "Challenge token required"),
});

export const claimBuyerTransactionSchema = z.object({
  token: z.string().min(8, "Transaction token required").optional(),
  challengeId: z.string().optional(),
  challengeToken: z.string().optional(),
});

export const createMergeRequestSchema = z.object({
  targetIdentityId: z.string().uuid().optional(),
  targetEmail: z.string().email().optional(),
  targetPhone: z.string().min(6).optional(),
  targetProvider: buyerIdentityProviderEnum.optional(),
  targetExternalId: z.string().min(1).optional(),
});

export const confirmMergeRequestSchema = z.object({
  requestId: z.string().uuid("Merge request ID required"),
  code: z.string().min(4, "Verification code required").max(10),
});

export type UpdateBuyerProfileInput = z.infer<typeof updateBuyerProfileSchema>;
export type LinkBuyerIdentityInput = z.infer<typeof linkBuyerIdentitySchema>;
export type RequestContactVerificationInput = z.infer<typeof requestContactVerificationSchema>;
export type VerifyContactCodeInput = z.infer<typeof verifyContactCodeSchema>;
export type CreateBuyerClaimChallengeInput = z.infer<typeof createBuyerClaimChallengeSchema>;
export type ConsumeBuyerClaimChallengeInput = z.infer<typeof consumeBuyerClaimChallengeSchema>;
export type ClaimBuyerTransactionInput = z.infer<typeof claimBuyerTransactionSchema>;
export type CreateMergeRequestInput = z.infer<typeof createMergeRequestSchema>;
export type ConfirmMergeRequestInput = z.infer<typeof confirmMergeRequestSchema>;

