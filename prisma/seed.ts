import {
  PrismaClient,
  MemberRole,
  OrderStatus,
  PaymentStatus,
  OrderSource,
  ConversationChannel,
  ConversationStatus,
  MessageSenderType,
  MessageType,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding OrderFlow test database...");

  // 1. Clean existing test data if exists
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.businessProfile.deleteMany();
  await prisma.businessMember.deleteMany();
  await prisma.business.deleteMany();
  await prisma.user.deleteMany();

  // 2. Create User
  const passwordHash = await bcrypt.hash("Password123", 10);
  const user = await prisma.user.create({
    data: {
      name: "Sarah Jenkins",
      email: "sarah@orderflow.test",
      passwordHash,
      systemRole: "USER",
    },
  });

  // 3. Create Business
  const business = await prisma.business.create({
    data: {
      name: "Sarah's Atelier",
      slug: "sarahs-atelier",
      currency: "USD",
      timezone: "America/New_York",
      phone: "+1 555 234 5678",
      email: "orders@sarahsatelier.com",
      address: "450 Fashion Blvd, Suite 201, New York, NY",
    },
  });

  // 4. Create BusinessMember
  await prisma.businessMember.create({
    data: {
      businessId: business.id,
      userId: user.id,
      role: MemberRole.OWNER,
    },
  });

  // 5. Create BusinessProfile
  await prisma.businessProfile.create({
    data: {
      businessId: business.id,
      instagramHandle: "@sarahs.atelier",
      whatsappNumber: "+15550192834",
      orderPrefix: "ATELIER-",
      autoConfirmOrders: false,
      bankDetails: "Chase Bank - Acct: *******4921 / Zelle: orders@sarahsatelier.com",
    },
  });

  // 6. Create Products
  const scarf = await prisma.product.create({
    data: {
      businessId: business.id,
      title: "Handmade Mulberry Silk Scarf",
      sku: "SLK-001",
      price: 65.0,
      costPrice: 22.0,
      stockQuantity: 42,
      trackInventory: true,
    },
  });

  const bag = await prisma.product.create({
    data: {
      businessId: business.id,
      title: "Italian Leather Everyday Tote",
      sku: "LTH-002",
      price: 185.0,
      costPrice: 75.0,
      stockQuantity: 14,
      trackInventory: true,
    },
  });

  // 7. Create Customers
  const customer1 = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: "Emily Vance",
      phone: "+1 555 982 1102",
      email: "emily.vance@example.com",
      instagramHandle: "@emilyvance",
      totalSpent: 250.0,
      ordersCount: 2,
      tags: ["VIP", "Instagram Buyer"],
    },
  });

  const customer2 = await prisma.customer.create({
    data: {
      businessId: business.id,
      name: "Marcus Reed",
      phone: "+1 555 432 9981",
      email: "m.reed@example.com",
      totalSpent: 65.0,
      ordersCount: 1,
      tags: ["WhatsApp Buyer"],
    },
  });

  // 8. Create Orders
  // Order 1: Paid & Confirmed from WhatsApp
  await prisma.order.create({
    data: {
      businessId: business.id,
      customerId: customer1.id,
      orderNumber: "ATELIER-1001",
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PAID,
      source: OrderSource.WHATSAPP,
      currency: "USD",
      subtotal: 185.0,
      shipping: 10.0,
      totalAmount: 195.0,
      requiresApproval: false,
      shippingAddress: "742 Evergreen Terrace, Brooklyn, NY",
      items: {
        create: [
          {
            productId: bag.id,
            title: bag.title,
            sku: bag.sku,
            quantity: 1,
            unitPrice: 185.0,
            totalPrice: 185.0,
          },
        ],
      },
    },
  });

  // Order 2: AI-extracted Draft needing Review from Instagram
  await prisma.order.create({
    data: {
      businessId: business.id,
      customerId: customer2.id,
      orderNumber: "ATELIER-1002",
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      source: OrderSource.INSTAGRAM,
      currency: "USD",
      subtotal: 65.0,
      shipping: 5.0,
      totalAmount: 70.0,
      requiresApproval: true, // Needs seller confirmation!
      customerNotes: "Extracted from Instagram DM: Marcus asked for silk scarf in rose color.",
      items: {
        create: [
          {
            productId: scarf.id,
            title: scarf.title,
            sku: scarf.sku,
            quantity: 1,
            unitPrice: 65.0,
            totalPrice: 65.0,
          },
        ],
      },
    },
  });

  // 9. Create Sample Conversations for Unified Inbox
  // WhatsApp Chat 1: Ready for Order Extraction
  const conv1 = await prisma.conversation.create({
    data: {
      businessId: business.id,
      customerId: customer1.id,
      channel: ConversationChannel.WHATSAPP,
      status: ConversationStatus.OPEN,
      contactIdentifier: "+1 555 982 1102",
      contactName: "Emily Vance",
      lastMessageAt: new Date(Date.now() - 1000 * 60 * 15),
      lastMessageSnippet: "I want to order 1 Mulberry Silk Scarf. Please deliver to 742 Evergreen Terrace, Brooklyn, NY.",
      unreadCount: 1,
      internalNotes: "Prefers gift packaging if possible.",
      messages: {
        create: [
          {
            senderType: MessageSenderType.CUSTOMER,
            senderName: "Emily Vance",
            content: "Hi Sarah! I saw your new collection on Instagram.",
            messageType: MessageType.TEXT,
            createdAt: new Date(Date.now() - 1000 * 60 * 30),
          },
          {
            senderType: MessageSenderType.SELLER,
            senderName: "Sarah Jenkins",
            content: "Hello Emily! Thank you so much. Which item caught your eye?",
            messageType: MessageType.TEXT,
            createdAt: new Date(Date.now() - 1000 * 60 * 25),
          },
          {
            senderType: MessageSenderType.CUSTOMER,
            senderName: "Emily Vance",
            content: "I want to order 1 Handmade Mulberry Silk Scarf please. Deliver to: 742 Evergreen Terrace, Brooklyn, NY 11201. My phone is +1 555 982 1102. Can I pay via UPI or Card?",
            messageType: MessageType.TEXT,
            createdAt: new Date(Date.now() - 1000 * 60 * 15),
          },
        ],
      },
    },
  });

  // Instagram Chat 2: Inbound Inquiry
  await prisma.conversation.create({
    data: {
      businessId: business.id,
      channel: ConversationChannel.INSTAGRAM,
      status: ConversationStatus.OPEN,
      contactIdentifier: "@maya_style",
      contactName: "Maya Lin",
      lastMessageAt: new Date(Date.now() - 1000 * 60 * 45),
      lastMessageSnippet: "Do you have the Italian Leather Tote in stock?",
      unreadCount: 1,
      messages: {
        create: [
          {
            senderType: MessageSenderType.CUSTOMER,
            senderName: "Maya Lin",
            content: "Hey Sarah! Do you have the Italian Leather Everyday Tote in stock? Can you ship to Austin, TX?",
            messageType: MessageType.TEXT,
            createdAt: new Date(Date.now() - 1000 * 60 * 45),
          },
        ],
      },
    },
  });

  console.log("Seeding complete! Sample merchant user: sarah@orderflow.test (Password: Password123)");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
