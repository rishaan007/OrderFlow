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
  method: z
    .enum([
      "UPI",
      "CASH",
      "BANK_TRANSFER",
      "CARD",
      "RAZORPAY",
      "STRIPE",
      "WALLET",
      "NET_BANKING",
      "OTHER",
    ])
    .default("UPI"),
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
  "X",
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
  "X_DM",
  "TWEET",
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

export type CreateSocialTransactionInput = z.input<typeof createSocialTransactionSchema>;
export type CreateTimelineEventInput = z.input<typeof createTimelineEventSchema>;
export type AddEvidenceInput = z.input<typeof addEvidenceSchema>;
export type CreateDisputeInput = z.input<typeof createDisputeSchema>;
export type UpdateDisputeInput = z.infer<typeof updateDisputeSchema>;
export type UpsertChannelListingInput = z.input<typeof upsertChannelListingSchema>;

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

// ============================================================================
// Phase 4 — Trust, Risk, Reputation & Dispute Intelligence Schemas
// ============================================================================

export const trustSignalCategoryEnum = z.enum([
  "IDENTITY",
  "PAYMENT",
  "FULFILLMENT",
  "DELIVERY",
  "COMMUNICATION",
  "DISPUTE",
  "REFUND",
  "RETURN",
  "ORDER_HISTORY",
  "ACCOUNT_SECURITY",
  "TRANSACTION",
]);

export const trustSignalDirectionEnum = z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]);

export const trustSignalSeverityEnum = z.enum([
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const transactionRiskLevelEnum = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "REVIEW_REQUIRED",
]);

export const riskReviewStatusEnum = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "DISMISSED",
  "ESCALATED",
]);

export const disputeCategoryEnum = z.enum([
  "ITEM_NOT_RECEIVED",
  "ITEM_NOT_AS_DESCRIBED",
  "DAMAGED_ITEM",
  "WRONG_ITEM",
  "PAYMENT_DISPUTE",
  "REFUND_NOT_RECEIVED",
  "DUPLICATE_PAYMENT",
  "SELLER_NON_FULFILLMENT",
  "BUYER_NON_PAYMENT",
  "DELIVERY_DISPUTE",
  "OTHER",
]);

export const createDisputeCaseSchema = z.object({
  transactionId: z.string().min(1, "Transaction ID required"),
  category: disputeCategoryEnum.default("OTHER"),
  reason: z.string().min(3, "Reason required").max(500),
  buyerNotes: z.string().max(2000).optional().nullable(),
  refundAmount: z.coerce.number().min(0).optional().nullable(),
  evidenceUrls: z.array(z.string().url("Valid evidence URL required")).optional(),
  mediaUrl: z.string().url("Valid evidence media URL required").optional().nullable(),
  initialEvidenceNotes: z.string().max(1000).optional().nullable(),
});

export const requestDisputeEvidenceSchema = z.object({
  requestedFrom: z.enum(["BUYER", "SELLER"]),
  notes: z.string().min(3, "Explanation of requested evidence required").max(1000),
});

export const submitDisputeEvidenceSchema = z.object({
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
    "COMMUNICATION_TRANSCRIPT",
    "REFUND_PROOF",
    "RETURN_TRACKING",
  ]),
  actor: z.enum(["BUYER", "SELLER", "SYSTEM", "CARRIER"]).default("BUYER"),
  source: z.string().default("PORTAL"),
  mediaUrl: z.string().url("Valid URL required").optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  trackingToken: z.string().min(8).optional(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export const reviewDisputeCaseSchema = z.object({
  notes: z.string().max(1000).optional().nullable(),
});

export const resolveDisputeCaseSchema = z.object({
  resolution: z.enum(["APPROVED", "REJECTED", "RESOLVED", "REFUNDED", "CLOSED"]),
  resolutionReason: z.string().min(3, "Resolution reason required").max(500),
  refundAmount: z.coerce.number().min(0).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const escalateDisputeCaseSchema = z.object({
  reason: z.string().min(3, "Escalation reason required").max(500),
});

export const resolveRiskReviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "ESCALATED", "DISMISSED"]),
  notes: z.string().min(3, "Review notes required").max(1000),
});

export const recordTrustSignalSchema = z.object({
  buyerIdentityId: z.string().uuid().optional().nullable(),
  socialTransactionId: z.string().uuid().optional().nullable(),
  orderId: z.string().uuid().optional().nullable(),
  signalType: z.string().min(1).max(100),
  category: trustSignalCategoryEnum,
  direction: trustSignalDirectionEnum,
  severity: trustSignalSeverityEnum,
  scoreValue: z.number().optional().nullable(),
  confidence: z.number().min(0).max(1).default(1.0),
  explanation: z.string().min(3).max(1000),
  sourceType: z.string().min(1).max(100),
  sourceId: z.string().optional().nullable(),
  sampleSize: z.number().int().min(0).optional().nullable(),
  observationWindow: z.string().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
});

export type CreateDisputeCaseInput = z.infer<typeof createDisputeCaseSchema>;
export type RequestDisputeEvidenceInput = z.infer<typeof requestDisputeEvidenceSchema>;
export type SubmitDisputeEvidenceInput = z.infer<typeof submitDisputeEvidenceSchema>;
export type ReviewDisputeCaseInput = z.infer<typeof reviewDisputeCaseSchema>;
export type ResolveDisputeCaseInput = z.infer<typeof resolveDisputeCaseSchema>;
export type EscalateDisputeCaseInput = z.infer<typeof escalateDisputeCaseSchema>;
export type ResolveRiskReviewInput = z.infer<typeof resolveRiskReviewSchema>;
export type RecordTrustSignalInput = z.infer<typeof recordTrustSignalSchema>;

// ============================================================================
// Phase 5 — Commerce Infrastructure (Payments, Logistics, Returns, Reconciliation)
// ============================================================================

export const paymentProviderEnum = z.enum([
  "RAZORPAY",
  "STRIPE",
  "MANUAL",
  "OTHER",
]);

export const paymentMethodExtendedEnum = z.enum([
  "UPI",
  "CASH",
  "BANK_TRANSFER",
  "CARD",
  "RAZORPAY",
  "STRIPE",
  "WALLET",
  "NET_BANKING",
  "OTHER",
]);

export const returnReasonEnum = z.enum([
  "WRONG_ITEM",
  "DAMAGED_ITEM",
  "ITEM_NOT_AS_DESCRIBED",
  "SIZE_ISSUE",
  "CHANGED_MIND",
  "DEFECTIVE_ITEM",
  "MISSING_ITEM",
  "OTHER",
]);

export const returnStatusEnum = z.enum([
  "REQUESTED",
  "APPROVED",
  "REJECTED",
  "LABEL_CREATED",
  "IN_TRANSIT",
  "RECEIVED",
  "INSPECTED",
  "REFUND_PENDING",
  "REFUNDED",
  "CANCELLED",
]);

export const shipmentStatusExtendedEnum = z.enum([
  "CREATED",
  "PENDING",
  "LABEL_CREATED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "DISPATCHED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_ATTEMPT",
  "RETURNED_TO_ORIGIN",
  "LOST",
  "DAMAGED",
  "CANCELLED",
]);

export const createPaymentIntentSchema = z.object({
  orderId: z.string().uuid("Valid orderId required"),
  provider: paymentProviderEnum.default("MANUAL"),
  amountMinorUnits: z.number().int().positive("Amount minor units must be positive integer").optional(),
  currency: z.string().length(3, "ISO-4217 3-letter currency required").optional(),
  idempotencyKey: z.string().min(4, "idempotencyKey must be at least 4 characters").max(128),
  description: z.string().max(255).optional(),
  expiresInMinutes: z.number().int().min(5).max(10080).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const attemptPaymentIntentSchema = z.object({
  method: paymentMethodExtendedEnum.default("CARD"),
  amountMinorUnits: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(4).max(128),
  providerPaymentId: z.string().max(128).optional(),
  referenceNumber: z.string().max(128).optional(),
  autoCapture: z.boolean().default(true),
  simulateFailure: z.boolean().optional(),
  failureCode: z.string().max(64).optional(),
  failureReason: z.string().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const capturePaymentIntentSchema = z.object({
  amountMinorUnits: z.number().int().positive().optional(),
  providerPaymentId: z.string().max(128).optional(),
  idempotencyKey: z.string().min(4).max(128),
});

export const createRefundSchema = z.object({
  orderId: z.string().uuid("Valid orderId required"),
  paymentId: z.string().uuid().optional().nullable(),
  paymentIntentId: z.string().uuid().optional().nullable(),
  returnRequestId: z.string().uuid().optional().nullable(),
  disputeId: z.string().uuid().optional().nullable(),
  type: z
    .enum([
      "FULL_REFUND",
      "PARTIAL_REFUND",
      "CANCELLATION_REFUND",
      "RETURN_REFUND",
      "DISPUTE_REFUND",
      "MANUAL_REFUND",
    ])
    .optional(),
  amountMinorUnits: z.number().int().positive("Refund amountMinorUnits must be positive integer"),
  currency: z.string().length(3).optional(),
  reason: z.string().min(3, "Refund reason required").max(500),
  provider: paymentProviderEnum.optional(),
  idempotencyKey: z.string().min(4).max(128),
  processImmediately: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

export const createReturnRequestSchema = z.object({
  orderId: z.string().uuid("Valid orderId required"),
  reason: returnReasonEnum,
  buyerNotes: z.string().max(2000).optional().nullable(),
  evidenceUrls: z.array(z.string().url()).optional(),
  disputeId: z.string().uuid().optional().nullable(),
  bypassPolicyWindow: z.boolean().optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.number().int().positive(),
        reason: z.string().max(300).optional().nullable(),
      })
    )
    .optional(),
});

export const publicCreateReturnRequestSchema = z.object({
  reason: returnReasonEnum,
  buyerNotes: z.string().max(2000).optional().nullable(),
  evidenceUrls: z.array(z.string().url()).optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.number().int().positive(),
        reason: z.string().max(300).optional().nullable(),
      })
    )
    .optional(),
});

export const updateReturnStatusSchema = z.object({
  status: returnStatusEnum,
  sellerResponse: z.string().max(1000).optional().nullable(),
  approvedAmountMinorUnits: z.number().int().nonnegative().optional().nullable(),
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
    .optional()
    .nullable(),
  trackingNumber: z.string().max(128).optional().nullable(),
  returnLabelUrl: z.string().url().optional().nullable(),
  inspectionNotes: z.string().max(1000).optional().nullable(),
  inspectionPassed: z.boolean().optional().nullable(),
  restockInventory: z.boolean().optional(),
  issueRefund: z.boolean().optional(),
});

export const receiveReturnSchema = z.object({
  inspectionPassed: z.boolean(),
  inspectionNotes: z.string().max(1000).optional(),
  restockInventory: z.boolean().optional(),
  issueRefund: z.boolean().optional(),
  approvedAmountMinorUnits: z.number().int().nonnegative().optional(),
});

export const createTrackingEventSchema = z.object({
  status: shipmentStatusExtendedEnum,
  provider: z.string().max(50).default("MANUAL"),
  providerEventId: z.string().max(128).optional().nullable(),
  trackingNumber: z.string().max(128).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  location: z.string().max(255).optional().nullable(),
  occurredAt: z.string().datetime().optional(),
});

export const runReconciliationSchema = z.object({
  type: z.enum(["PAYMENT", "REFUND", "SHIPMENT"]),
  provider: z.string().max(50).optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  providerRecords: z
    .array(
      z.object({
        provider: z.string().min(1),
        providerEntityId: z.string().min(1),
        providerOrderId: z.string().optional(),
        orderId: z.string().optional(),
        amountMinorUnits: z.number().int(),
        currency: z.string().length(3),
        status: z.string().min(1),
      })
    )
    .optional(),
});

export const resolveReconciliationEntrySchema = z.object({
  resolutionNotes: z.string().min(3).max(1000),
});

export const upsertPaymentProviderConfigSchema = z.object({
  provider: paymentProviderEnum,
  environment: z.enum(["sandbox", "live"]).default("sandbox"),
  enabled: z.boolean().default(true),
  accountIdentifier: z.string().max(128).optional().nullable(),
  credentials: z
    .object({
      keyId: z.string().optional(),
      keySecret: z.string().optional(),
      webhookSecret: z.string().optional(),
      merchantId: z.string().optional(),
    })
    .optional()
    .nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});
