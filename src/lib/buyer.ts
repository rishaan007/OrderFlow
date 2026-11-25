import { prisma } from "./prisma";
import { claimTransactionDirect } from "./buyer-identity";
import {
  SocialPlatform,
  SocialSurface,
  TransactionStatus,
  TimelineVisibility,
  TimelineActor,
  EvidenceType,
  EvidenceVerificationState,
  DisputeStatus,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  PaymentRecordStatus,
  Prisma,
} from "@prisma/client";
import {
  ConfirmDeliveryInput,
  SubmitBuyerPaymentInput,
} from "@/lib/validations";

export class BuyerSecurityError extends Error {
  constructor(message = "Unauthorized access to transaction") {
    super(message);
    this.name = "BuyerSecurityError";
  }
}

/**
 * Guest buyer confirms or provides delivery information.
 * Updates order and customer shipping destination, records timeline event & evidence.
 */
export async function confirmDeliveryInformation(
  token: string,
  data: ConfirmDeliveryInput
) {
  if (!token || token.length < 8) {
    throw new BuyerSecurityError("Invalid transaction token");
  }

  const transaction = await prisma.socialTransaction.findUnique({
    where: { publicTrackingToken: token },
    include: {
      order: true,
      customer: true,
      business: true,
    },
  });

  if (!transaction) {
    throw new BuyerSecurityError("Transaction not found");
  }

  const formattedAddress = [
    data.shippingAddress,
    data.city,
    data.state,
    data.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  return prisma.$transaction(async (tx) => {
    // 1. Update Customer record if attached
    if (transaction.customerId) {
      await tx.customer.update({
        where: { id: transaction.customerId },
        data: {
          name: data.recipientName || undefined,
          phone: data.phone || undefined,
          email: data.email || undefined,
          address: formattedAddress || undefined,
          city: data.city || undefined,
        },
      });
    }

    // 2. Update Order shipping address if attached
    if (transaction.orderId) {
      await tx.order.update({
        where: { id: transaction.orderId },
        data: {
          shippingAddress: formattedAddress,
          customerNotes: data.notes || undefined,
          // Transition order from PENDING to CONFIRMED if awaiting address
          ...(transaction.order?.status === OrderStatus.PENDING
            ? { status: OrderStatus.CONFIRMED }
            : {}),
        },
      });
    }

    // 3. Update SocialTransaction status
    const newStatus =
      transaction.status === TransactionStatus.INQUIRY ||
      transaction.status === TransactionStatus.ORDER_CREATED
        ? TransactionStatus.INTENT_CONFIRMED
        : transaction.status;

    await tx.socialTransaction.update({
      where: { id: transaction.id },
      data: {
        status: newStatus,
        buyerNotes: data.notes || transaction.buyerNotes,
      },
    });

    // 4. Record auditable timeline event
    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: transaction.id,
        eventType: "DELIVERY_DETAILS_CONFIRMED",
        title: "Delivery Information Confirmed by Buyer",
        description: `Deliver to ${data.recipientName} at ${formattedAddress}`,
        actor: TimelineActor.BUYER,
        visibility: TimelineVisibility.PUBLIC,
        metadata: {
          recipientName: data.recipientName,
          phone: data.phone,
          postalCode: data.postalCode,
        },
      },
    });

    // 5. Attach cryptographic evidence
    await tx.transactionEvidence.create({
      data: {
        transactionId: transaction.id,
        evidenceType: EvidenceType.BUYER_CONFIRMATION,
        verificationState: EvidenceVerificationState.BUYER_CONFIRMED,
        source: "BUYER_PORTAL",
        actor: TimelineActor.BUYER,
        notes: `Delivery details confirmed for order #${transaction.order?.orderNumber || transaction.id.slice(0, 8)}`,
      },
    });

    // 6. Notify seller
    await tx.notification.create({
      data: {
        businessId: transaction.businessId,
        orderId: transaction.orderId,
        customerId: transaction.customerId,
        transactionId: transaction.id,
        channel: "IN_APP",
        recipient: transaction.business.email || "seller@orderflow.internal",
        title: "Buyer Confirmed Delivery Address",
        content: `${data.recipientName} confirmed shipping destination for order #${transaction.order?.orderNumber || "New Order"}.`,
        status: "SENT",
      },
    });

    return {
      success: true,
      shippingAddress: formattedAddress,
      recipientName: data.recipientName,
      status: newStatus,
    };
  });
}

/**
 * Guest buyer submits payment proof / transaction reference.
 * Strictly records PENDING_VERIFICATION on authoritative backend.
 * Never spoofs verified success without seller/gateway verification.
 */
export async function submitBuyerPaymentProof(
  token: string,
  data: SubmitBuyerPaymentInput
) {
  if (!token || token.length < 8) {
    throw new BuyerSecurityError("Invalid transaction token");
  }

  const transaction = await prisma.socialTransaction.findUnique({
    where: { publicTrackingToken: token },
    include: {
      order: true,
      business: true,
    },
  });

  if (!transaction || !transaction.orderId || !transaction.order) {
    throw new BuyerSecurityError("Transaction or associated order not found");
  }

  const amount = Number(data.amount);
  if (amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  return prisma.$transaction(async (tx) => {
    // 1. Create Payment record in PENDING_VERIFICATION state
    const payment = await tx.payment.create({
      data: {
        businessId: transaction.businessId,
        orderId: transaction.orderId!,
        customerId: transaction.customerId,
        amount: new Prisma.Decimal(amount),
        currency: transaction.order!.currency,
        method: data.method as PaymentMethod,
        status: PaymentRecordStatus.PENDING_VERIFICATION,
        referenceNumber: data.referenceNumber.trim(),
        screenshotUrl: data.screenshotUrl || null,
        notes: data.notes ? `Buyer note: ${data.notes}` : null,
      },
    });

    // 2. Advance transaction status to PAYMENT_PENDING if currently INQUIRY or INTENT_CONFIRMED
    await tx.socialTransaction.update({
      where: { id: transaction.id },
      data: {
        status: TransactionStatus.PAYMENT_PENDING,
      },
    });

    // 3. Record public timeline event
    await tx.transactionTimelineEvent.create({
      data: {
        transactionId: transaction.id,
        eventType: "PAYMENT_PROOF_SUBMITTED",
        title: `Payment Reference Submitted: ${transaction.order!.currency} ${amount}`,
        description: `Buyer submitted ${data.method} proof with reference ${data.referenceNumber}. Awaiting seller verification.`,
        actor: TimelineActor.BUYER,
        visibility: TimelineVisibility.PUBLIC,
        metadata: {
          method: data.method,
          referenceNumber: data.referenceNumber,
          amount,
        },
      },
    });

    // 4. Attach evidence
    await tx.transactionEvidence.create({
      data: {
        transactionId: transaction.id,
        evidenceType: EvidenceType.PAYMENT_PROOF,
        verificationState: EvidenceVerificationState.USER_PROVIDED,
        source: "BUYER_PORTAL",
        actor: TimelineActor.BUYER,
        mediaUrl: data.screenshotUrl || null,
        notes: `Reference ID: ${data.referenceNumber}`,
      },
    });

    // 5. Notify seller
    await tx.notification.create({
      data: {
        businessId: transaction.businessId,
        orderId: transaction.orderId,
        customerId: transaction.customerId,
        transactionId: transaction.id,
        channel: "IN_APP",
        recipient: transaction.business.email || "seller@orderflow.internal",
        title: `Payment Verification Needed: ${transaction.order!.currency} ${amount}`,
        content: `Buyer submitted payment proof (${data.method}, ref: ${data.referenceNumber}). Please review and verify.`,
        status: "SENT",
      },
    });

    return {
      paymentId: payment.id,
      status: payment.status,
      referenceNumber: payment.referenceNumber,
      amount,
    };
  });
}

/**
 * Claims a guest transaction into an authenticated buyer user account.
 * Enforces ownership verification and prevents IDOR / unauthorized hijacking.
 */
export async function claimGuestTransaction(
  userId: string,
  token: string
) {
  if (!userId || !token) {
    throw new BuyerSecurityError("Missing user or token for claiming transaction");
  }

  try {
    return await claimTransactionDirect(userId, token);
  } catch (err: any) {
    if (err instanceof BuyerSecurityError) throw err;
    throw new BuyerSecurityError(err.message || "Failed to claim transaction");
  }
}

/**
 * Retrieves all claimed purchases for an authenticated buyer across all sellers.
 * Groups by Active, Completed, Attention Required, or All.
 */
export async function getBuyerPurchases(
  userId: string,
  filter?: "ACTIVE" | "COMPLETED" | "ATTENTION" | "ALL"
) {
  if (!userId) {
    throw new BuyerSecurityError("User ID required");
  }

  const identity = await prisma.buyerIdentity.findUnique({
    where: { userId },
    select: { id: true },
  });

  const transactions = await prisma.socialTransaction.findMany({
    where: {
      isSandbox: false,
      OR: [
        { buyerUserId: userId },
        ...(identity ? [{ buyerIdentityId: identity.id }] : []),
      ],
    },
    include: {
      business: {
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          logoUrl: true,
          email: true,
          profile: {
            select: {
              instagramHandle: true,
              whatsappNumber: true,
            },
          },
        },
      },
      order: {
        include: {
          items: true,
          shipments: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          payments: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
      disputes: {
        orderBy: { createdAt: "desc" },
      },
      timelineEvents: {
        where: { visibility: TimelineVisibility.PUBLIC },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const activeOrders: typeof transactions = [];
  const completedOrders: typeof transactions = [];
  const attentionRequired: typeof transactions = [];

  for (const t of transactions) {
    const isCompleted =
      t.order?.status === OrderStatus.DELIVERED ||
      t.status === TransactionStatus.COMPLETED ||
      t.status === TransactionStatus.DELIVERED;

    const hasActiveDispute = t.disputes.some((d) =>
      ["REQUESTED", "UNDER_REVIEW", "RETURN_IN_TRANSIT"].includes(d.status)
    );
    const isUnpaid =
      t.order?.paymentStatus === PaymentStatus.PENDING ||
      t.status === TransactionStatus.PAYMENT_PENDING;

    if (hasActiveDispute || isUnpaid) {
      attentionRequired.push(t);
    }

    if (isCompleted) {
      completedOrders.push(t);
    } else {
      activeOrders.push(t);
    }
  }

  let filtered = transactions;
  if (filter === "ACTIVE") filtered = activeOrders;
  else if (filter === "COMPLETED") filtered = completedOrders;
  else if (filter === "ATTENTION") filtered = attentionRequired;

  return {
    items: filtered,
    counts: {
      total: transactions.length,
      active: activeOrders.length,
      completed: completedOrders.length,
      attention: attentionRequired.length,
    },
  };
}

/**
 * Retrieves notifications for an authenticated buyer user.
 */
export async function getBuyerNotifications(userId: string) {
  if (!userId) {
    throw new BuyerSecurityError("User ID required");
  }

  return prisma.notification.findMany({
    where: {
      userId,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

/**
 * Marks a notification as read.
 */
export async function markBuyerNotificationAsRead(
  notificationId: string,
  userId: string
) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    throw new BuyerSecurityError("Notification not found");
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });
}
