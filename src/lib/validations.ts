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
