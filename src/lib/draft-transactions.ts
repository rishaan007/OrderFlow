import { prisma } from "@/lib/prisma";
import {
  SocialPlatform,
  SocialSurface,
  TransactionStatus,
  TimelineActor,
  TimelineVisibility,
  EvidenceType,
  EvidenceVerificationState,
  OrderStatus,
  PaymentStatus,
  ConversationStatus,
  MessageSenderType,
  MessageType,
  Prisma,
} from "@prisma/client";
import { getTenantDb, TenantAccessError } from "./tenant";
import { mapOrderSourceToSocialContext } from "./transactions";

export interface DraftTransactionItem {
  productId?: string | null;
  variantId?: string | null;
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
}

export interface CreateDraftTransactionInput {
  businessId: string;
  conversationId: string;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  shippingAddress?: string | null;
  city?: string | null;
  items: DraftTransactionItem[];
  discount?: number;
  shipping?: number;
  notes?: string | null;
  platform?: SocialPlatform;
  surface?: SocialSurface;
  externalDetails?: {
    externalUserId?: string;
    externalConversationId?: string;
    externalMessageId?: string;
    externalProductId?: string;
    externalListingId?: string;
  };
}

export interface ConfirmDraftInput {
  customerName?: string;
  shippingAddress?: string;
  city?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  allowDuplicate?: boolean;
}

/**
 * Creates a structured draft transaction from a social conversation
 */
export async function createDraftTransaction(
  input: CreateDraftTransactionInput
) {
  const { businessId, conversationId, items } = input;

  // 1. Verify conversation belongs to tenant
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, businessId },
    include: { customer: true },
  });

  if (!conversation) {
    throw new TenantAccessError(
      "Conversation not found or not accessible within this business"
    );
  }

  // 2. Derive platform and surface from conversation if not explicitly provided
  let platform = input.platform;
  let surface = input.surface;

  if (!platform) {
    if (conversation.channel === "INSTAGRAM") {
      platform = SocialPlatform.INSTAGRAM;
      surface = SocialSurface.DM;
    } else if (conversation.channel === "WHATSAPP") {
      platform = SocialPlatform.WHATSAPP;
      surface = SocialSurface.DIRECT_CHAT;
    } else if (conversation.channel === "FACEBOOK") {
      platform = SocialPlatform.FACEBOOK;
      surface = SocialSurface.MESSENGER;
    } else if (conversation.channel === "X") {
      platform = SocialPlatform.X;
      surface = SocialSurface.X_DM;
    } else {
      platform = SocialPlatform.MANUAL;
      surface = SocialSurface.MANUAL_ENTRY;
    }
  }

  // Calculate pricing
  const subtotal = items.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );
  const discount = input.discount || 0;
  const shipping = input.shipping || 0;
  const totalAmount = Math.max(0, subtotal - discount + shipping);

  // 3. Create Draft SocialTransaction entity
  const transaction = await prisma.socialTransaction.create({
    data: {
      businessId,
      conversationId,
      customerId: input.customerId || conversation.customerId || null,
      platform,
      surface: surface || SocialSurface.DIRECT_CHAT,
      status: TransactionStatus.INQUIRY,
      externalUserId:
        input.externalDetails?.externalUserId || conversation.externalChatId || null,
      externalConversationId:
        input.externalDetails?.externalConversationId || conversation.id,
      externalListingId: input.externalDetails?.externalListingId || null,
      buyerNotes: input.notes || null,
      metadata: {
        isDraft: true,
        draftItems: items,
        subtotal,
        discount,
        shipping,
        totalAmount,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail,
        shippingAddress: input.shippingAddress,
        city: input.city,
      } as unknown as Prisma.InputJsonValue,
      timelineEvents: {
        create: [
          {
            eventType: "DRAFT_TRANSACTION_CREATED",
            title: "Draft Transaction Created",
            description: `Draft created from ${platform} conversation with ${input.customerName}. Subtotal: $${subtotal}.`,
            actor: TimelineActor.SELLER,
            visibility: TimelineVisibility.INTERNAL_ONLY,
          },
        ],
      },
      evidence: {
        create: [
          {
            evidenceType: EvidenceType.ORIGINAL_MESSAGE,
            verificationState: EvidenceVerificationState.OBSERVED,
            source: `${platform}_CONVERSATION`,
            actor: TimelineActor.BUYER,
            notes: `Originating conversation ID: ${conversationId}`,
          },
        ],
      },
    },
    include: {
      timelineEvents: true,
      evidence: true,
      customer: true,
    },
  });

  return {
    id: transaction.id,
    publicTrackingToken: transaction.publicTrackingToken,
    platform: transaction.platform,
    surface: transaction.surface,
    status: transaction.status,
    subtotal,
    discount,
    shipping,
    totalAmount,
    items,
    customerName: input.customerName,
    shippingAddress: input.shippingAddress,
    createdAt: transaction.createdAt,
  };
}

/**
 * Retrieves a draft transaction with multi-tenant verification
 */
export async function getDraftTransaction(
  businessId: string,
  transactionId: string
) {
  const transaction = await prisma.socialTransaction.findFirst({
    where: { id: transactionId, businessId },
    include: {
      conversation: true,
      customer: true,
      order: {
        include: {
          items: true,
        },
      },
      timelineEvents: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!transaction) {
    throw new TenantAccessError("Draft transaction not found");
  }

  const meta = (transaction.metadata as any) || {};

  return {
    ...transaction,
    isDraft: !!meta.isDraft,
    draftItems: (meta.draftItems as DraftTransactionItem[]) || [],
    subtotal: meta.subtotal || 0,
    discount: meta.discount || 0,
    shipping: meta.shipping || 0,
    totalAmount: meta.totalAmount || 0,
    customerName: meta.customerName,
    shippingAddress: meta.shippingAddress,
  };
}

/**
 * Confirms a draft transaction: validates items, deducts inventory, creates the official Order,
 * links attribution, and advances SocialTransaction status to ORDER_CREATED
 */
export async function confirmDraftTransaction(
  businessId: string,
  transactionId: string,
  confirmationData?: ConfirmDraftInput
) {
  const draft = await getDraftTransaction(businessId, transactionId);

  if (draft.orderId) {
    throw new Error("This draft transaction has already been confirmed into an order");
  }

  const items = draft.draftItems;
  if (!items || items.length === 0) {
    throw new Error("Draft has no items to create an order");
  }

  const customerName =
    confirmationData?.customerName || draft.customerName || "Social Commerce Customer";
  const shippingAddress =
    confirmationData?.shippingAddress ||
    draft.shippingAddress ||
    "Pending Address Confirmation";
  const customerPhone =
    confirmationData?.customerPhone || (draft.metadata as any)?.customerPhone;
  const customerEmail =
    confirmationData?.customerEmail || (draft.metadata as any)?.customerEmail;
  const city = confirmationData?.city || (draft.metadata as any)?.city;

  const tenantDb = getTenantDb(businessId);

  // 1. Resolve customer
  let customerId = draft.customerId;
  if (!customerId) {
    const newCustomer = await prisma.customer.create({
      data: {
        businessId,
        name: customerName,
        phone: customerPhone || null,
        email: customerEmail || null,
        address: shippingAddress,
        city: city || null,
      },
    });
    customerId = newCustomer.id;
  }

  // Map platform to OrderSource
  const platformSourceMap: Record<SocialPlatform, any> = {
    [SocialPlatform.INSTAGRAM]: "INSTAGRAM",
    [SocialPlatform.WHATSAPP]: "WHATSAPP",
    [SocialPlatform.FACEBOOK]: "FACEBOOK",
    [SocialPlatform.X]: "X",
    [SocialPlatform.MANUAL]: "MANUAL",
    [SocialPlatform.OTHER]: "ONLINE",
    [SocialPlatform.TIKTOK]: "ONLINE",
    [SocialPlatform.TELEGRAM]: "ONLINE",
  };

  const orderSource = platformSourceMap[draft.platform] || "MANUAL";

  // 2. Create the official order using tenantDb (enforces stock deduction, pricing, quota)
  const order = await tenantDb.createOrder({
    customerId,
    source: orderSource,
    status: OrderStatus.CONFIRMED,
    paymentStatus: PaymentStatus.PENDING,
    discount: draft.discount || 0,
    shipping: draft.shipping || 0,
    shippingAddress,
    notes: confirmationData?.notes || `Confirmed from ${draft.platform} draft transaction`,
    conversationId: draft.conversationId || undefined,
    socialTransactionId: transactionId,
    items: items.map((it) => ({
      productId: it.productId,
      variantId: it.variantId,
      title: it.title,
      variantTitle: it.variantTitle,
      sku: it.sku,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
  });

  // 3. Link Order to existing SocialTransaction & update status
  const updatedTransaction = await prisma.socialTransaction.update({
    where: { id: transactionId },
    data: {
      orderId: order.id,
      customerId,
      status: TransactionStatus.ORDER_CREATED,
      metadata: {
        ...(typeof draft.metadata === "object" ? draft.metadata : {}),
        isDraft: false,
        confirmedAt: new Date(),
        orderNumber: order.orderNumber,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // 4. Record Timeline Confirmation Event
  await prisma.transactionTimelineEvent.create({
    data: {
      transactionId,
      eventType: "TRANSACTION_CONFIRMED",
      title: `Order #${order.orderNumber} Confirmed`,
      description: `Draft transaction confirmed into active order by seller. Total: $${order.totalAmount}`,
      actor: TimelineActor.SELLER,
      visibility: TimelineVisibility.PUBLIC,
    },
  });

  // 5. Update Conversation if attached
  if (draft.conversationId) {
    await prisma.conversation.update({
      where: { id: draft.conversationId },
      data: {
        status: ConversationStatus.ORDER_CREATED,
      },
    });

    await prisma.message.create({
      data: {
        conversationId: draft.conversationId,
        senderType: MessageSenderType.SYSTEM,
        senderName: "System",
        content: `🎉 Draft transaction confirmed into Order #${order.orderNumber} ($${order.totalAmount}). Status: CONFIRMED. Tracking Room: /t/${updatedTransaction.publicTrackingToken}`,
        messageType: MessageType.TEXT,
      },
    });
  }

  return {
    success: true,
    transaction: updatedTransaction,
    order,
    publicRoomUrl: `/t/${updatedTransaction.publicTrackingToken}`,
  };
}
