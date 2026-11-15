import { prisma } from "./prisma";
import {
  AutomationJobType,
  JobStatus,
  NotificationStatus,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { sendWhatsAppMessage } from "./integrations/whatsapp";
import { sendInstagramMessage } from "./integrations/instagram";

/**
 * Enqueues a business automation job to PostgreSQL
 */
export async function queueAutomationJob(
  businessId: string,
  type: AutomationJobType,
  payload: Record<string, any>,
  scheduledFor: Date = new Date()
) {
  return prisma.automationJob.create({
    data: {
      businessId,
      type,
      payload,
      status: JobStatus.PENDING,
      scheduledFor,
    },
  });
}

/**
 * Dispatches an automated notification and records in Notification table
 */
export async function dispatchCustomerNotification(options: {
  businessId: string;
  orderId?: string | null;
  customerId?: string | null;
  channel?: string;
  recipient: string;
  title: string;
  content: string;
}) {
  const { businessId, orderId, customerId, recipient, title, content } = options;
  const channel = options.channel || (recipient.startsWith("+") ? "WHATSAPP" : recipient.startsWith("@") ? "INSTAGRAM" : "IN_APP");

  // Create notification record in QUEUED status
  const notification = await prisma.notification.create({
    data: {
      businessId,
      orderId: orderId || null,
      customerId: customerId || null,
      channel,
      recipient,
      title,
      content,
      status: NotificationStatus.QUEUED,
    },
  });

  // Attempt external dispatch via official Meta APIs if credentials exist
  let isSent = false;
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: { profile: true },
    });
    const profile = business?.profile;

    if (channel === "WHATSAPP" && recipient) {
      const res = await sendWhatsAppMessage({
        phoneNumberId: profile?.whatsappPhoneNumberId,
        accessToken: profile?.whatsappAccessToken,
        to: recipient,
        text: `${title}\n\n${content}`,
      });
      isSent = res.success;
    } else if (channel === "INSTAGRAM" && recipient) {
      const res = await sendInstagramMessage({
        pageAccessToken: profile?.instagramAccessToken,
        recipientId: recipient,
        text: `${title}\n\n${content}`,
      });
      isSent = res.success;
    } else {
      isSent = true; // In-app notification marked sent
    }
  } catch (err) {
    console.warn("Outbound notification dispatch error:", err);
  }

  // Update notification status
  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: isSent ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: isSent ? new Date() : null,
    },
  });

  return notification;
}

/**
 * Executes a single automation job
 */
export async function executeAutomationJob(jobId: string) {
  const job = await prisma.automationJob.findUnique({
    where: { id: jobId },
    include: { business: { include: { profile: true } } },
  });

  if (!job || job.status === JobStatus.COMPLETED) return null;

  // Mark job as PROCESSING
  await prisma.automationJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PROCESSING,
      attempts: { increment: 1 },
    },
  });

  try {
    const payload = job.payload as Record<string, any>;

    switch (job.type) {
      case "NEW_ORDER": {
        // Dispatches order confirmation notification
        const order = await prisma.order.findUnique({
          where: { id: payload.orderId },
          include: { customer: true },
        });
        if (order) {
          const recipient = order.customer?.phone || order.customer?.instagramHandle || "Customer";
          await dispatchCustomerNotification({
            businessId: job.businessId,
            orderId: order.id,
            customerId: order.customerId,
            recipient,
            title: `Order Confirmed: #${order.orderNumber}`,
            content: `Thank you for your order! Your order total is $${Number(order.totalAmount).toFixed(2)}. We will update you once it ships.`,
          });
        }
        break;
      }

      case "PAYMENT_REMINDER": {
        // Dispatches payment reminder with bank/UPI details
        const order = await prisma.order.findUnique({
          where: { id: payload.orderId },
          include: { customer: true },
        });
        if (order && order.paymentStatus !== "PAID") {
          const recipient = order.customer?.phone || order.customer?.instagramHandle || "Customer";
          const bankDetails = job.business.profile?.bankDetails || "Please contact seller for payment details.";
          const balance = Number(order.totalAmount) - Number(order.amountPaid);
          await dispatchCustomerNotification({
            businessId: job.businessId,
            orderId: order.id,
            customerId: order.customerId,
            recipient,
            title: `Payment Reminder for Order #${order.orderNumber}`,
            content: `Friendly reminder: Your order has an outstanding balance of $${balance.toFixed(2)}.\n\nPayment details:\n${bankDetails}`,
          });
        }
        break;
      }

      case "ORDER_STATUS_UPDATE": {
        // Dispatches status transition update
        const order = await prisma.order.findUnique({
          where: { id: payload.orderId },
          include: { customer: true },
        });
        if (order) {
          const recipient = order.customer?.phone || order.customer?.instagramHandle || "Customer";
          await dispatchCustomerNotification({
            businessId: job.businessId,
            orderId: order.id,
            customerId: order.customerId,
            recipient,
            title: `Order Status Update: #${order.orderNumber}`,
            content: `Your order is now ${order.status.toLowerCase()}. Thank you for shopping with ${job.business.name}!`,
          });
        }
        break;
      }

      case "DELIVERY_DISPATCH": {
        // Dispatches tracking link and delivery partner info
        const shipment = await prisma.shipment.findUnique({
          where: { id: payload.shipmentId },
          include: { order: { include: { customer: true } } },
        });
        if (shipment && shipment.order) {
          const recipient = shipment.order.customer?.phone || shipment.order.customer?.instagramHandle || "Customer";
          const trackingMsg = shipment.trackingNumber
            ? `Track your package via ${shipment.carrier}: ${shipment.trackingNumber}`
            : `Carrier: ${shipment.carrier}`;
          await dispatchCustomerNotification({
            businessId: job.businessId,
            orderId: shipment.order.id,
            customerId: shipment.order.customerId,
            recipient,
            title: `Your Order #${shipment.order.orderNumber} Has Shipped! 🚀`,
            content: `Your shipment has been dispatched.\n\n${trackingMsg}\nDestination: ${shipment.shippingAddress}`,
          });
        }
        break;
      }

      case "DELIVERY_DELIVERED": {
        // Dispatches delivery confirmation
        const shipment = await prisma.shipment.findUnique({
          where: { id: payload.shipmentId },
          include: { order: { include: { customer: true } } },
        });
        if (shipment && shipment.order) {
          const recipient = shipment.order.customer?.phone || shipment.order.customer?.instagramHandle || "Customer";
          await dispatchCustomerNotification({
            businessId: job.businessId,
            orderId: shipment.order.id,
            customerId: shipment.order.customerId,
            recipient,
            title: `Package Delivered: #${shipment.order.orderNumber} 🎉`,
            content: `Your package has been delivered successfully. Enjoy your items!`,
          });
        }
        break;
      }

      case "LOW_STOCK_ALERT": {
        // Records internal merchant low stock notification
        await dispatchCustomerNotification({
          businessId: job.businessId,
          recipient: "MERCHANT_INBOX",
          channel: "IN_APP",
          title: `Low Stock Alert: ${payload.productTitle}`,
          content: `Inventory alert: "${payload.productTitle}" is below threshold (Available: ${payload.stockQuantity}). Please restock soon.`,
        });
        break;
      }

      case "INVENTORY_RESTORE": {
        // Restores inventory on cancelled order or returned shipment
        const order = await prisma.order.findUnique({
          where: { id: payload.orderId },
          include: { items: true },
        });
        if (order && order.stockDeducted) {
          await prisma.$transaction(async (tx) => {
            for (const item of order.items) {
              if (item.variantId) {
                await tx.productVariant.update({
                  where: { id: item.variantId },
                  data: { stockQuantity: { increment: item.quantity } },
                });
              } else if (item.productId) {
                await tx.product.update({
                  where: { id: item.productId },
                  data: { stockQuantity: { increment: item.quantity } },
                });
              }
            }
            await tx.order.update({
              where: { id: order.id },
              data: { stockDeducted: false },
            });
            await tx.auditLog.create({
              data: {
                businessId: job.businessId,
                action: "INVENTORY_RESTORED_AUTOMATION",
                entityType: "ORDER",
                entityId: order.id,
                metadata: { reason: payload.reason || "Order cancelled or shipment returned" },
              },
            });
          });
        }
        break;
      }
    }

    // Mark job as COMPLETED
    const updated = await prisma.automationJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        processedAt: new Date(),
        lastError: null,
      },
    });

    return updated;
  } catch (err: any) {
    console.error(`Automation job ${jobId} failed:`, err);
    return prisma.automationJob.update({
      where: { id: jobId },
      data: {
        status: job.attempts + 1 >= job.maxAttempts ? JobStatus.FAILED : JobStatus.PENDING,
        lastError: err.message || "Unknown error",
      },
    });
  }
}

/**
 * Processes all pending jobs scheduled for execution
 */
export async function processPendingAutomationJobs(businessId?: string) {
  const where: Prisma.AutomationJobWhereInput = {
    status: JobStatus.PENDING,
    scheduledFor: { lte: new Date() },
  };
  if (businessId) {
    where.businessId = businessId;
  }

  const pendingJobs = await prisma.automationJob.findMany({
    where,
    orderBy: { scheduledFor: "asc" },
    take: 20,
  });

  const results = [];
  for (const job of pendingJobs) {
    const res = await executeAutomationJob(job.id);
    if (res) results.push(res);
  }

  return results;
}
