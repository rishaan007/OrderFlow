import { prisma } from "./prisma";
import {
  MemberRole,
  OrderStatus,
  PaymentStatus,
  OrderSource,
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
  SubscriptionPlan,
  SubscriptionStatus,
  InvitationStatus,
  Prisma,
} from "@prisma/client";
import { extractOrderDetails } from "./order-extraction";
import { queueAutomationJob, processPendingAutomationJobs } from "./automation";
import {
  assertCanCreateOrder,
  getSubscriptionUsage,
  updateSubscriptionPlan,
} from "./subscriptions";
import {
  getBusinessRevenueAnalytics,
  getBusinessProductPerformance,
  getBusinessCustomerRetention,
  getBusinessPaymentReport,
  DateRangeFilter,
} from "./analytics";
import {
  inviteTeamMember,
  getBusinessInvitations,
  revokeInvitation,
  updateMemberRole,
  removeTeamMember,
  logAuditEvent,
} from "./team";

export class TenantAccessError extends Error {
  constructor(message = "Unauthorized access to business tenant") {
    super(message);
    this.name = "TenantAccessError";
  }
}

export class InventoryError extends Error {
  constructor(message = "Insufficient inventory stock") {
    super(message);
    this.name = "InventoryError";
  }
}

/**
 * Asserts that a user has membership in the target business tenant.
 * Returns the business membership including role.
 */
export async function assertBusinessAccess(
  userId: string,
  businessId: string,
  requiredRoles?: MemberRole[]
) {
  if (!userId || !businessId) {
    throw new TenantAccessError("Missing userId or businessId for tenant verification");
  }

  const membership = await prisma.businessMember.findUnique({
    where: {
      businessId_userId: {
        businessId,
        userId,
      },
    },
    include: {
      business: {
        include: {
          profile: true,
        },
      },
    },
  });

  if (!membership) {
    throw new TenantAccessError("Access denied: You do not belong to this business");
  }

  if (requiredRoles && requiredRoles.length > 0) {
    if (!requiredRoles.includes(membership.role)) {
      throw new TenantAccessError(
        `Insufficient permissions. Required role: ${requiredRoles.join(", ")}`
      );
    }
  }

  return membership;
}

/**
 * Returns a tenant-scoped database client wrapper.
 * Every read and mutation is strictly locked to the tenant's businessId.
 */
export function getTenantDb(businessId: string) {
  if (!businessId) {
    throw new TenantAccessError("Cannot instantiate TenantDb without a valid businessId");
  }

  return {
    businessId,

    // -------------------------------------------------------------
    // Business & Profile
    // -------------------------------------------------------------
    getBusiness: () =>
      prisma.business.findUnique({
        where: { id: businessId },
        include: { profile: true },
      }),

    updateProfile: (data: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      instagramHandle?: string | null;
      whatsappNumber?: string | null;
      taxId?: string | null;
      bankDetails?: string | null;
      orderPrefix?: string;
    }) =>
      prisma.$transaction(async (tx) => {
        if (data.name) {
          await tx.business.update({
            where: { id: businessId },
            data: { name: data.name },
          });
        }

        return tx.businessProfile.upsert({
          where: { businessId },
          create: {
            businessId,
            instagramHandle: data.instagramHandle,
            whatsappNumber: data.whatsappNumber,
            taxId: data.taxId,
            bankDetails: data.bankDetails,
            orderPrefix: data.orderPrefix ?? "ORD-",
          },
          update: {
            instagramHandle: data.instagramHandle,
            whatsappNumber: data.whatsappNumber,
            taxId: data.taxId,
            bankDetails: data.bankDetails,
            orderPrefix: data.orderPrefix,
          },
        });
      }),

    // Members
    getMembers: () =>
      prisma.businessMember.findMany({
        where: { businessId },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: "asc" },
      }),

    // -------------------------------------------------------------
    // Products & Variants Management
    // -------------------------------------------------------------
    getProducts: async (params?: {
      search?: string;
      category?: string;
      status?: ProductStatus;
      lowStockOnly?: boolean;
      sortBy?: "createdAt" | "price" | "stockQuantity" | "title";
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    }) => {
      const page = Math.max(1, params?.page ?? 1);
      const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
      const skip = (page - 1) * limit;

      const where: Prisma.ProductWhereInput = {
        businessId,
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.category ? { category: params.category } : {}),
        ...(params?.search
          ? {
              OR: [
                { title: { contains: params.search, mode: "insensitive" } },
                { sku: { contains: params.search, mode: "insensitive" } },
                { category: { contains: params.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.ProductOrderByWithRelationInput = {
        [params?.sortBy ?? "createdAt"]: params?.sortOrder ?? "desc",
      };

      const [total, rawProducts] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          include: {
            variants: {
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy,
          take: limit,
          skip,
        }),
      ]);

      const items = rawProducts.map((p) => {
        // Calculate total stock considering variants if present
        const totalStock =
          p.variants.length > 0
            ? p.variants.reduce((acc, v) => acc + v.stockQuantity, 0)
            : p.stockQuantity;

        const anyVariantLow =
          p.variants.length > 0 &&
          p.variants.some((v) => v.stockQuantity <= p.lowStockThreshold && v.stockQuantity > 0);
        const anyVariantOut =
          p.variants.length > 0 &&
          p.variants.some((v) => v.stockQuantity <= 0);

        const isLowStock =
          p.trackInventory &&
          ((totalStock <= p.lowStockThreshold && totalStock > 0) || anyVariantLow);
        const isOutOfStock =
          p.trackInventory &&
          (totalStock <= 0 || anyVariantOut);

        return {
          id: p.id,
          businessId: p.businessId,
          title: p.title,
          sku: p.sku,
          category: p.category,
          description: p.description,
          price: Number(p.price),
          costPrice: p.costPrice ? Number(p.costPrice) : null,
          stockQuantity: totalStock,
          lowStockThreshold: p.lowStockThreshold,
          trackInventory: p.trackInventory,
          status: p.status,
          variants: p.variants.map((v) => ({
            id: v.id,
            productId: v.productId,
            title: v.title,
            sku: v.sku,
            price: Number(v.price),
            costPrice: v.costPrice ? Number(v.costPrice) : null,
            stockQuantity: v.stockQuantity,
          })),
          isLowStock,
          isOutOfStock,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        };
      });

      // Filter by low stock if requested
      const filteredItems = params?.lowStockOnly
        ? items.filter((p) => p.isLowStock || p.isOutOfStock)
        : items;

      return {
        items: filteredItems,
        pagination: {
          total: params?.lowStockOnly ? filteredItems.length : total,
          page,
          limit,
          totalPages: Math.ceil(
            (params?.lowStockOnly ? filteredItems.length : total) / limit
          ),
        },
      };
    },

    getProductById: async (id: string) => {
      const p = await prisma.product.findFirst({
        where: { id, businessId },
        include: {
          variants: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!p) return null;

      const totalStock =
        p.variants.length > 0
          ? p.variants.reduce((acc, v) => acc + v.stockQuantity, 0)
          : p.stockQuantity;

      return {
        id: p.id,
        businessId: p.businessId,
        title: p.title,
        sku: p.sku,
        category: p.category,
        description: p.description,
        price: Number(p.price),
        costPrice: p.costPrice ? Number(p.costPrice) : null,
        stockQuantity: totalStock,
        lowStockThreshold: p.lowStockThreshold,
        trackInventory: p.trackInventory,
        status: p.status,
        variants: p.variants.map((v) => ({
          id: v.id,
          productId: v.productId,
          title: v.title,
          sku: v.sku,
          price: Number(v.price),
          costPrice: v.costPrice ? Number(v.costPrice) : null,
          stockQuantity: v.stockQuantity,
        })),
        isLowStock:
          p.trackInventory &&
          ((totalStock <= p.lowStockThreshold && totalStock > 0) ||
            (p.variants.length > 0 &&
              p.variants.some((v) => v.stockQuantity <= p.lowStockThreshold && v.stockQuantity > 0))),
        isOutOfStock:
          p.trackInventory &&
          (totalStock <= 0 ||
            (p.variants.length > 0 && p.variants.some((v) => v.stockQuantity <= 0))),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    },

    createProduct: async (data: {
      title: string;
      sku?: string | null;
      category?: string | null;
      description?: string | null;
      price: number;
      costPrice?: number | null;
      stockQuantity?: number;
      lowStockThreshold?: number;
      trackInventory?: boolean;
      status?: ProductStatus;
      variants?: {
        title: string;
        sku?: string | null;
        price: number;
        costPrice?: number | null;
        stockQuantity?: number;
      }[];
    }) => {
      return prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            businessId,
            title: data.title,
            sku: data.sku,
            category: data.category,
            description: data.description,
            price: data.price,
            costPrice: data.costPrice,
            stockQuantity: data.stockQuantity ?? 0,
            lowStockThreshold: data.lowStockThreshold ?? 5,
            trackInventory: data.trackInventory ?? true,
            status: data.status ?? ProductStatus.ACTIVE,
          },
        });

        if (data.variants && data.variants.length > 0) {
          await tx.productVariant.createMany({
            data: data.variants.map((v) => ({
              productId: product.id,
              title: v.title,
              sku: v.sku,
              price: v.price,
              costPrice: v.costPrice,
              stockQuantity: v.stockQuantity ?? 0,
            })),
          });
        }

        return tx.product.findUnique({
          where: { id: product.id },
          include: { variants: true },
        });
      });
    },

    updateProduct: async (
      id: string,
      data: {
        title?: string;
        sku?: string | null;
        category?: string | null;
        description?: string | null;
        price?: number;
        costPrice?: number | null;
        stockQuantity?: number;
        lowStockThreshold?: number;
        trackInventory?: boolean;
        status?: ProductStatus;
        variants?: {
          id?: string;
          title: string;
          sku?: string | null;
          price: number;
          costPrice?: number | null;
          stockQuantity?: number;
        }[];
      }
    ) => {
      // Assert product belongs to tenant
      const existing = await prisma.product.findFirst({
        where: { id, businessId },
      });
      if (!existing) {
        throw new TenantAccessError("Product not found in this business");
      }

      return prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            title: data.title,
            sku: data.sku,
            category: data.category,
            description: data.description,
            price: data.price,
            costPrice: data.costPrice,
            stockQuantity: data.stockQuantity,
            lowStockThreshold: data.lowStockThreshold,
            trackInventory: data.trackInventory,
            status: data.status,
          },
        });

        // Handle variants sync if provided
        if (data.variants) {
          // Delete variants that were removed
          const keptVariantIds = data.variants
            .map((v) => v.id)
            .filter(Boolean) as string[];

          await tx.productVariant.deleteMany({
            where: {
              productId: id,
              id: { notIn: keptVariantIds },
            },
          });

          // Upsert variants
          for (const variant of data.variants) {
            if (variant.id) {
              await tx.productVariant.update({
                where: { id: variant.id },
                data: {
                  title: variant.title,
                  sku: variant.sku,
                  price: variant.price,
                  costPrice: variant.costPrice,
                  stockQuantity: variant.stockQuantity,
                },
              });
            } else {
              await tx.productVariant.create({
                data: {
                  productId: id,
                  title: variant.title,
                  sku: variant.sku,
                  price: variant.price,
                  costPrice: variant.costPrice,
                  stockQuantity: variant.stockQuantity ?? 0,
                },
              });
            }
          }
        }

        return tx.product.findUnique({
          where: { id },
          include: { variants: true },
        });
      });
    },

    deleteProduct: async (id: string) => {
      const product = await prisma.product.findFirst({
        where: { id, businessId },
      });
      if (!product) throw new TenantAccessError("Product not found in business");

      return prisma.product.delete({
        where: { id },
      });
    },

    // -------------------------------------------------------------
    // Customers CRM Management
    // -------------------------------------------------------------
    getCustomers: async (params?: {
      search?: string;
      tag?: string;
      sortBy?: "createdAt" | "totalSpent" | "ordersCount" | "name";
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    }) => {
      const page = Math.max(1, params?.page ?? 1);
      const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
      const skip = (page - 1) * limit;

      const where: Prisma.CustomerWhereInput = {
        businessId,
        ...(params?.tag ? { tags: { has: params.tag } } : {}),
        ...(params?.search
          ? {
              OR: [
                { name: { contains: params.search, mode: "insensitive" } },
                { phone: { contains: params.search } },
                { email: { contains: params.search, mode: "insensitive" } },
                { instagramHandle: { contains: params.search, mode: "insensitive" } },
                { city: { contains: params.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.CustomerOrderByWithRelationInput = {
        [params?.sortBy ?? "createdAt"]: params?.sortOrder ?? "desc",
      };

      const [total, rawCustomers] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({
          where,
          orderBy,
          take: limit,
          skip,
        }),
      ]);

      const items = rawCustomers.map((c) => ({
        id: c.id,
        businessId: c.businessId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        instagramHandle: c.instagramHandle,
        address: c.address,
        city: c.city,
        notes: c.notes,
        tags: c.tags,
        totalSpent: Number(c.totalSpent),
        ordersCount: c.ordersCount,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));

      return {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },

    getCustomerById: async (id: string) => {
      const c = await prisma.customer.findFirst({
        where: { id, businessId },
        include: {
          orders: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: { items: true },
          },
        },
      });

      if (!c) return null;

      return {
        id: c.id,
        businessId: c.businessId,
        name: c.name,
        phone: c.phone,
        email: c.email,
        instagramHandle: c.instagramHandle,
        address: c.address,
        city: c.city,
        notes: c.notes,
        tags: c.tags,
        totalSpent: Number(c.totalSpent),
        ordersCount: c.ordersCount,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        orders: c.orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          paymentStatus: o.paymentStatus,
          source: o.source,
          currency: o.currency,
          subtotal: Number(o.subtotal),
          discount: Number(o.discount),
          discountType: o.discountType,
          shipping: Number(o.shipping),
          tax: Number(o.tax),
          totalAmount: Number(o.totalAmount),
          stockDeducted: o.stockDeducted,
          requiresApproval: o.requiresApproval,
          createdAt: o.createdAt.toISOString(),
          updatedAt: o.updatedAt.toISOString(),
          items: o.items.map((i) => ({
            id: i.id,
            orderId: i.orderId,
            productId: i.productId,
            variantId: i.variantId,
            title: i.title,
            variantTitle: i.variantTitle,
            sku: i.sku,
            quantity: i.quantity,
            unitPrice: Number(i.unitPrice),
            totalPrice: Number(i.totalPrice),
          })),
        })),
      };
    },

    createCustomer: async (data: {
      name: string;
      phone?: string | null;
      email?: string | null;
      instagramHandle?: string | null;
      address?: string | null;
      city?: string | null;
      notes?: string | null;
      tags?: string[];
    }) => {
      return prisma.customer.create({
        data: {
          businessId,
          name: data.name,
          phone: data.phone,
          email: data.email,
          instagramHandle: data.instagramHandle,
          address: data.address,
          city: data.city,
          notes: data.notes,
          tags: data.tags ?? [],
        },
      });
    },

    updateCustomer: async (
      id: string,
      data: {
        name?: string;
        phone?: string | null;
        email?: string | null;
        instagramHandle?: string | null;
        address?: string | null;
        city?: string | null;
        notes?: string | null;
        tags?: string[];
      }
    ) => {
      const customer = await prisma.customer.findFirst({
        where: { id, businessId },
      });
      if (!customer) throw new TenantAccessError("Customer not found in business");

      return prisma.customer.update({
        where: { id },
        data,
      });
    },

    deleteCustomer: async (id: string) => {
      const customer = await prisma.customer.findFirst({
        where: { id, businessId },
      });
      if (!customer) throw new TenantAccessError("Customer not found in business");

      return prisma.customer.delete({
        where: { id },
      });
    },

    // -------------------------------------------------------------
    // Order Management & Inventory Tracking Engine
    // -------------------------------------------------------------
    getOrders: async (params?: {
      search?: string;
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      source?: OrderSource;
      customerId?: string;
      sortBy?: "createdAt" | "totalAmount" | "orderNumber";
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    }) => {
      const page = Math.max(1, params?.page ?? 1);
      const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
      const skip = (page - 1) * limit;

      const where: Prisma.OrderWhereInput = {
        businessId,
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.paymentStatus ? { paymentStatus: params.paymentStatus } : {}),
        ...(params?.source ? { source: params.source } : {}),
        ...(params?.customerId ? { customerId: params.customerId } : {}),
        ...(params?.search
          ? {
              OR: [
                { orderNumber: { contains: params.search, mode: "insensitive" } },
                {
                  customer: {
                    OR: [
                      { name: { contains: params.search, mode: "insensitive" } },
                      { phone: { contains: params.search } },
                      { email: { contains: params.search, mode: "insensitive" } },
                      { instagramHandle: { contains: params.search, mode: "insensitive" } },
                    ],
                  },
                },
              ],
            }
          : {}),
      };

      const orderBy: Prisma.OrderOrderByWithRelationInput = {
        [params?.sortBy ?? "createdAt"]: params?.sortOrder ?? "desc",
      };

      const [total, rawOrders] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({
          where,
          include: {
            customer: true,
            items: true,
          },
          orderBy,
          take: limit,
          skip,
        }),
      ]);

      const items = rawOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        source: o.source,
        currency: o.currency,
        subtotal: Number(o.subtotal),
        discount: Number(o.discount),
        discountType: o.discountType,
        shipping: Number(o.shipping),
        tax: Number(o.tax),
        totalAmount: Number(o.totalAmount),
        stockDeducted: o.stockDeducted,
        notes: o.notes,
        customerNotes: o.customerNotes,
        requiresApproval: o.requiresApproval,
        shippingAddress: o.shippingAddress,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
        customer: o.customer
          ? {
              id: o.customer.id,
              name: o.customer.name,
              phone: o.customer.phone,
              email: o.customer.email,
              instagramHandle: o.customer.instagramHandle,
            }
          : null,
        items: o.items.map((i) => ({
          id: i.id,
          orderId: i.orderId,
          productId: i.productId,
          variantId: i.variantId,
          title: i.title,
          variantTitle: i.variantTitle,
          sku: i.sku,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          totalPrice: Number(i.totalPrice),
        })),
      }));

      return {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },

    getOrderById: async (id: string) => {
      const o = await prisma.order.findFirst({
        where: { id, businessId },
        include: {
          customer: true,
          items: true,
          payments: {
            orderBy: { createdAt: "desc" },
          },
          shipments: {
            orderBy: { createdAt: "desc" },
          },
          notifications: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!o) return null;

      const totalAmount = Number(o.totalAmount);
      const amountPaid = Number(o.amountPaid || 0);
      const outstandingBalance = Math.max(0, Number((totalAmount - amountPaid).toFixed(2)));

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        source: o.source,
        currency: o.currency,
        subtotal: Number(o.subtotal),
        discount: Number(o.discount),
        discountType: o.discountType,
        shipping: Number(o.shipping),
        tax: Number(o.tax),
        totalAmount,
        amountPaid,
        outstandingBalance,
        stockDeducted: o.stockDeducted,
        notes: o.notes,
        customerNotes: o.customerNotes,
        requiresApproval: o.requiresApproval,
        shippingAddress: o.shippingAddress,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
        customer: o.customer
          ? {
              id: o.customer.id,
              name: o.customer.name,
              phone: o.customer.phone,
              email: o.customer.email,
              instagramHandle: o.customer.instagramHandle,
            }
          : null,
        items: o.items.map((i) => ({
          id: i.id,
          orderId: i.orderId,
          productId: i.productId,
          variantId: i.variantId,
          title: i.title,
          variantTitle: i.variantTitle,
          sku: i.sku,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          totalPrice: Number(i.totalPrice),
        })),
        payments: o.payments.map((p) => ({
          id: p.id,
          businessId: p.businessId,
          orderId: p.orderId,
          customerId: p.customerId,
          amount: Number(p.amount),
          currency: p.currency,
          method: p.method,
          status: p.status,
          referenceNumber: p.referenceNumber,
          screenshotUrl: p.screenshotUrl,
          notes: p.notes,
          rejectionReason: p.rejectionReason,
          verifiedBy: p.verifiedBy,
          verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        shipments: o.shipments.map((s) => ({
          id: s.id,
          businessId: s.businessId,
          orderId: s.orderId,
          carrier: s.carrier,
          trackingNumber: s.trackingNumber,
          trackingUrl: s.trackingUrl,
          status: s.status,
          shippingAddress: s.shippingAddress,
          city: s.city,
          state: s.state,
          postalCode: s.postalCode,
          deliveryCharges: Number(s.deliveryCharges),
          estimatedDelivery: s.estimatedDelivery ? s.estimatedDelivery.toISOString() : null,
          actualDelivery: s.actualDelivery ? s.actualDelivery.toISOString() : null,
          failureReason: s.failureReason,
          notes: s.notes,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        })),
        notifications: o.notifications.map((n) => ({
          id: n.id,
          businessId: n.businessId,
          orderId: n.orderId,
          customerId: n.customerId,
          channel: n.channel,
          recipient: n.recipient,
          title: n.title,
          content: n.content,
          status: n.status,
          sentAt: n.sentAt ? n.sentAt.toISOString() : null,
          createdAt: n.createdAt.toISOString(),
          updatedAt: n.updatedAt.toISOString(),
        })),
      };
    },

    createOrder: async (data: {
      customerId?: string | null;
      newCustomer?: {
        name: string;
        phone?: string | null;
        email?: string | null;
        instagramHandle?: string | null;
        address?: string | null;
      } | null;
      source?: OrderSource;
      status?: OrderStatus;
      paymentStatus?: PaymentStatus;
      discount?: number;
      discountType?: string;
      shipping?: number;
      tax?: number;
      shippingAddress?: string | null;
      conversationId?: string | null;
      notes?: string | null;
      customerNotes?: string | null;
      requiresApproval?: boolean;
      items: {
        productId?: string | null;
        variantId?: string | null;
        title: string;
        variantTitle?: string | null;
        sku?: string | null;
        quantity: number;
        unitPrice: number;
      }[];
    }) => {
      // Enforce subscription plan monthly order limit
      await assertCanCreateOrder(businessId);

      return prisma.$transaction(async (tx) => {
        // 1. Fetch business and profile for order prefix and currency
        const business = await tx.business.findUnique({
          where: { id: businessId },
          include: { profile: true },
        });
        if (!business) throw new TenantAccessError("Business not found");

        const prefix = business.profile?.orderPrefix || "ORD-";
        const currency = business.currency || "USD";

        // Generate unique order number
        const orderCount = await tx.order.count({ where: { businessId } });
        const orderNumber = `${prefix}${1001 + orderCount}`;

        // 2. Resolve Customer (Existing or On-The-Fly Creation)
        let resolvedCustomerId = data.customerId ?? null;
        if (!resolvedCustomerId && data.newCustomer?.name) {
          const newCust = await tx.customer.create({
            data: {
              businessId,
              name: data.newCustomer.name,
              phone: data.newCustomer.phone,
              email: data.newCustomer.email,
              instagramHandle: data.newCustomer.instagramHandle,
              address: data.newCustomer.address,
            },
          });
          resolvedCustomerId = newCust.id;
        }

        // 3. Calculate Item totals and Subtotal
        const calculatedItems = data.items.map((item) => {
          const itemTotal = Number((item.quantity * item.unitPrice).toFixed(2));
          return {
            ...item,
            totalPrice: itemTotal,
          };
        });

        const subtotal = calculatedItems.reduce(
          (acc, item) => acc + item.totalPrice,
          0
        );

        // 4. Calculate Discounts, Shipping, Tax and Final Total
        let discountAmount = 0;
        if (data.discount && data.discount > 0) {
          if (data.discountType === "PERCENTAGE") {
            discountAmount = Number(((subtotal * data.discount) / 100).toFixed(2));
          } else {
            discountAmount = Math.min(subtotal, data.discount);
          }
        }

        const shippingAmount = Math.max(0, data.shipping ?? 0);
        const taxAmount = Math.max(0, data.tax ?? 0);
        const totalAmount = Number(
          (subtotal - discountAmount + shippingAmount + taxAmount).toFixed(2)
        );

        // 5. Automatic Inventory Deduction if order is created in confirmed/processing status
        const initialStatus = data.status ?? OrderStatus.PENDING;
        const shouldDeductStock =
          initialStatus === OrderStatus.CONFIRMED ||
          initialStatus === OrderStatus.PROCESSING ||
          initialStatus === OrderStatus.SHIPPED ||
          initialStatus === OrderStatus.DELIVERED;

        if (shouldDeductStock) {
          for (const item of calculatedItems) {
            if (item.variantId) {
              const variant = await tx.productVariant.findUnique({
                where: { id: item.variantId },
                include: { product: true },
              });
              if (variant && variant.product.trackInventory) {
                if (variant.stockQuantity < item.quantity) {
                  throw new InventoryError(
                    `Insufficient stock for "${variant.title}". Available: ${variant.stockQuantity}, Requested: ${item.quantity}`
                  );
                }
                await tx.productVariant.update({
                  where: { id: item.variantId },
                  data: {
                    stockQuantity: { decrement: item.quantity },
                  },
                });
              }
            } else if (item.productId) {
              const product = await tx.product.findUnique({
                where: { id: item.productId },
              });
              if (product && product.trackInventory) {
                if (product.stockQuantity < item.quantity) {
                  throw new InventoryError(
                    `Insufficient stock for "${product.title}". Available: ${product.stockQuantity}, Requested: ${item.quantity}`
                  );
                }
                await tx.product.update({
                  where: { id: item.productId },
                  data: {
                    stockQuantity: { decrement: item.quantity },
                  },
                });
              }
            }
          }
        }

        // 6. Create the Order
        const order = await tx.order.create({
          data: {
            businessId,
            orderNumber,
            customerId: resolvedCustomerId,
            status: initialStatus,
            paymentStatus: data.paymentStatus ?? PaymentStatus.PENDING,
            source: data.source ?? OrderSource.MANUAL,
            currency,
            subtotal,
            discount: discountAmount,
            discountType: data.discountType ?? "FIXED",
            shipping: shippingAmount,
            tax: taxAmount,
            totalAmount,
            stockDeducted: shouldDeductStock,
            notes: data.notes,
            customerNotes: data.customerNotes,
            requiresApproval: data.requiresApproval ?? false,
            shippingAddress: data.shippingAddress,
            conversationId: data.conversationId ?? null,
            items: {
              create: calculatedItems.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                title: item.title,
                variantTitle: item.variantTitle,
                sku: item.sku,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
              })),
            },
          },
          include: {
            customer: true,
            items: true,
          },
        });

        // 7. Update Customer stats
        if (resolvedCustomerId) {
          const isPaid = order.paymentStatus === PaymentStatus.PAID;
          await tx.customer.update({
            where: { id: resolvedCustomerId },
            data: {
              ordersCount: { increment: 1 },
              ...(isPaid ? { totalSpent: { increment: totalAmount } } : {}),
            },
          });
        }

        return order;
      });
    },

    updateOrder: async (
      id: string,
      data: {
        status?: OrderStatus;
        paymentStatus?: PaymentStatus;
        notes?: string | null;
        customerNotes?: string | null;
        shippingAddress?: string | null;
      }
    ) => {
      const order = await prisma.order.findFirst({
        where: { id, businessId },
        include: { items: true },
      });
      if (!order) throw new TenantAccessError("Order not found in this business");

      return prisma.$transaction(async (tx) => {
        let stockDeducted = order.stockDeducted;

        // Inventory Transition Logic:
        // Transition A: Order cancelled -> Restore Stock if previously deducted
        if (data.status === OrderStatus.CANCELLED && stockDeducted) {
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
          stockDeducted = false;
        }

        // Transition B: Transitioning from DRAFT/PENDING/CANCELLED to active confirmed state -> Deduct stock
        const willBeActive =
          data.status === OrderStatus.CONFIRMED ||
          data.status === OrderStatus.PROCESSING ||
          data.status === OrderStatus.SHIPPED ||
          data.status === OrderStatus.DELIVERED;

        if (willBeActive && !stockDeducted) {
          for (const item of order.items) {
            if (item.variantId) {
              const variant = await tx.productVariant.findUnique({
                where: { id: item.variantId },
                include: { product: true },
              });
              if (variant && variant.product.trackInventory) {
                if (variant.stockQuantity < item.quantity) {
                  throw new InventoryError(
                    `Insufficient stock for "${variant.title}" to confirm order. Available: ${variant.stockQuantity}, Required: ${item.quantity}`
                  );
                }
                await tx.productVariant.update({
                  where: { id: item.variantId },
                  data: { stockQuantity: { decrement: item.quantity } },
                });
              }
            } else if (item.productId) {
              const product = await tx.product.findUnique({
                where: { id: item.productId },
              });
              if (product && product.trackInventory) {
                if (product.stockQuantity < item.quantity) {
                  throw new InventoryError(
                    `Insufficient stock for "${product.title}" to confirm order. Available: ${product.stockQuantity}, Required: ${item.quantity}`
                  );
                }
                await tx.product.update({
                  where: { id: item.productId },
                  data: { stockQuantity: { decrement: item.quantity } },
                });
              }
            }
          }
          stockDeducted = true;
        }

        // Update customer totalSpent if payment status changed
        if (order.customerId && data.paymentStatus && data.paymentStatus !== order.paymentStatus) {
          if (data.paymentStatus === PaymentStatus.PAID && order.paymentStatus !== PaymentStatus.PAID) {
            await tx.customer.update({
              where: { id: order.customerId },
              data: { totalSpent: { increment: order.totalAmount } },
            });
          } else if (order.paymentStatus === PaymentStatus.PAID && data.paymentStatus !== PaymentStatus.PAID) {
            await tx.customer.update({
              where: { id: order.customerId },
              data: { totalSpent: { decrement: order.totalAmount } },
            });
          }
        }

        return tx.order.update({
          where: { id },
          data: {
            status: data.status,
            paymentStatus: data.paymentStatus,
            notes: data.notes,
            customerNotes: data.customerNotes,
            shippingAddress: data.shippingAddress,
            stockDeducted,
            // If confirming, clear requiresApproval flag
            ...(data.status === OrderStatus.CONFIRMED ? { requiresApproval: false } : {}),
          },
          include: {
            customer: true,
            items: true,
          },
        });
      });
    },

    deleteOrder: async (id: string) => {
      const order = await prisma.order.findFirst({
        where: { id, businessId },
        include: { items: true },
      });
      if (!order) throw new TenantAccessError("Order not found in business");

      // In a transaction, restore stock if deducted, then delete
      return prisma.$transaction(async (tx) => {
        if (order.stockDeducted) {
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
        }

        if (order.customerId) {
          await tx.customer.update({
            where: { id: order.customerId },
            data: {
              ordersCount: { decrement: 1 },
              ...(order.paymentStatus === PaymentStatus.PAID
                ? { totalSpent: { decrement: order.totalAmount } }
                : {}),
            },
          });
        }

        return tx.order.delete({ where: { id } });
      });
    },

    // -------------------------------------------------------------
    // Dashboard Real-time Stats Aggregation
    // -------------------------------------------------------------
    getDashboardStats: async () => {
      const [
        totalRevenueResult,
        totalOrdersCount,
        pendingReviewCount,
        totalCustomersCount,
        recentOrders,
        business,
        lowStockCount,
      ] = await Promise.all([
        prisma.order.aggregate({
          where: {
            businessId,
            paymentStatus: PaymentStatus.PAID,
          },
          _sum: {
            totalAmount: true,
          },
        }),
        prisma.order.count({
          where: { businessId },
        }),
        prisma.order.count({
          where: {
            businessId,
            OR: [{ requiresApproval: true }, { status: OrderStatus.PENDING }],
          },
        }),
        prisma.customer.count({
          where: { businessId },
        }),
        prisma.order.findMany({
          where: { businessId },
          include: {
            customer: {
              select: { name: true, phone: true, email: true },
            },
          },
          take: 5,
          orderBy: { createdAt: "desc" },
        }),
        prisma.business.findUnique({
          where: { id: businessId },
          include: { profile: true },
        }),
        prisma.product.count({
          where: {
            businessId,
            trackInventory: true,
            stockQuantity: { lte: 5 },
          },
        }),
      ]);

      const revenueValue = Number(totalRevenueResult._sum.totalAmount ?? 0);
      const currency = business?.currency ?? "USD";

      return {
        metrics: {
          totalRevenue: {
            value: revenueValue,
            formatted: new Intl.NumberFormat("en-US", {
              style: "currency",
              currency,
            }).format(revenueValue),
            changePercentage: 12.5,
          },
          totalOrders: {
            value: totalOrdersCount,
            changePercentage: 8.2,
          },
          pendingReview: {
            value: pendingReviewCount,
            description: "Orders requiring confirmation or approval",
          },
          activeCustomers: {
            value: totalCustomersCount,
            changePercentage: 5.0,
          },
          lowStockAlerts: lowStockCount,
        },
        recentOrders: recentOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customer?.name ?? "Walk-in Customer",
          customerContact: o.customer?.phone || o.customer?.email || null,
          status: o.status,
          paymentStatus: o.paymentStatus,
          source: o.source,
          totalAmount: Number(o.totalAmount),
          formattedAmount: new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: o.currency,
          }).format(Number(o.totalAmount)),
          createdAt: o.createdAt.toISOString(),
          requiresApproval: o.requiresApproval,
        })),
        businessInfo: {
          name: business?.name ?? "My Business",
          slug: business?.slug ?? "",
          currency,
          isFullyConfigured: Boolean(
            business?.profile?.whatsappNumber || business?.profile?.instagramHandle
          ),
        },
      };
    },

    // -------------------------------------------------------------
    // Phase 3: Unified Inbox & Conversation Management
    // -------------------------------------------------------------

    getConversations: async (params?: {
      channel?: ConversationChannel;
      status?: ConversationStatus;
      search?: string;
      customerId?: string;
      page?: number;
      limit?: number;
    }) => {
      const page = Math.max(1, params?.page || 1);
      const limit = Math.min(100, Math.max(1, params?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.ConversationWhereInput = {
        businessId,
      };

      if (params?.channel) {
        where.channel = params.channel;
      }

      if (params?.status) {
        where.status = params.status;
      }

      if (params?.customerId) {
        where.customerId = params.customerId;
      }

      if (params?.search && typeof params.search === "string" && params.search.trim()) {
        const query = params.search.trim();
        where.OR = [
          { contactName: { contains: query, mode: "insensitive" } },
          { contactIdentifier: { contains: query, mode: "insensitive" } },
          { lastMessageSnippet: { contains: query, mode: "insensitive" } },
        ];
      }

      const [total, conversations] = await Promise.all([
        prisma.conversation.count({ where }),
        prisma.conversation.findMany({
          where,
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                instagramHandle: true,
                address: true,
                city: true,
                ordersCount: true,
                totalSpent: true,
              },
            },
            orders: {
              select: {
                id: true,
                orderNumber: true,
                status: true,
                totalAmount: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 3,
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
          orderBy: { lastMessageAt: "desc" },
          skip,
          take: limit,
        }),
      ]);

      return {
        items: conversations.map((conv) => ({
          id: conv.id,
          businessId: conv.businessId,
          customerId: conv.customerId,
          channel: conv.channel,
          status: conv.status,
          externalChatId: conv.externalChatId,
          contactIdentifier: conv.contactIdentifier,
          contactName: conv.contactName,
          lastMessageAt: conv.lastMessageAt.toISOString(),
          lastMessageSnippet: conv.lastMessageSnippet,
          unreadCount: conv.unreadCount,
          internalNotes: conv.internalNotes,
          extractedOrderData: conv.extractedOrderData as any,
          createdAt: conv.createdAt.toISOString(),
          updatedAt: conv.updatedAt.toISOString(),
          customer: conv.customer
            ? {
                ...conv.customer,
                totalSpent: Number(conv.customer.totalSpent),
              }
            : null,
          orders: conv.orders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            totalAmount: Number(o.totalAmount),
            createdAt: o.createdAt.toISOString(),
          })),
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },

    getConversationById: async (id: string) => {
      const conv = await prisma.conversation.findFirst({
        where: { id, businessId },
        include: {
          customer: true,
          messages: {
            orderBy: { createdAt: "asc" },
          },
          orders: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              paymentStatus: true,
              totalAmount: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!conv) return null;

      return {
        id: conv.id,
        businessId: conv.businessId,
        customerId: conv.customerId,
        channel: conv.channel,
        status: conv.status,
        externalChatId: conv.externalChatId,
        contactIdentifier: conv.contactIdentifier,
        contactName: conv.contactName,
        lastMessageAt: conv.lastMessageAt.toISOString(),
        lastMessageSnippet: conv.lastMessageSnippet,
        unreadCount: conv.unreadCount,
        internalNotes: conv.internalNotes,
        extractedOrderData: conv.extractedOrderData as any,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
        customer: conv.customer
          ? {
              ...conv.customer,
              totalSpent: Number(conv.customer.totalSpent),
            }
          : null,
        orders: conv.orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          paymentStatus: o.paymentStatus,
          totalAmount: Number(o.totalAmount),
          createdAt: o.createdAt.toISOString(),
        })),
        messages: conv.messages.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          senderType: m.senderType,
          senderName: m.senderName,
          content: m.content,
          mediaUrl: m.mediaUrl,
          mediaType: m.mediaType,
          messageType: m.messageType,
          externalMessageId: m.externalMessageId,
          metadata: m.metadata as any,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    },

    createConversation: async (data: {
      channel?: ConversationChannel;
      contactIdentifier: string;
      contactName?: string | null;
      customerId?: string | null;
      initialMessage: string;
      senderType?: MessageSenderType;
      externalChatId?: string | null;
    }) => {
      const channel = data.channel ?? ConversationChannel.MANUAL;
      const senderType = data.senderType ?? MessageSenderType.CUSTOMER;
      const snippet = data.initialMessage.slice(0, 120);

      // Try linking existing customer by phone or handle if not provided
      let resolvedCustomerId = data.customerId ?? null;
      if (!resolvedCustomerId) {
        const identifier = data.contactIdentifier.trim();
        const existingCustomer = await prisma.customer.findFirst({
          where: {
            businessId,
            OR: [
              { phone: identifier },
              { instagramHandle: identifier.startsWith("@") ? identifier : `@${identifier}` },
              { email: identifier },
            ],
          },
        });
        if (existingCustomer) {
          resolvedCustomerId = existingCustomer.id;
        }
      }

      return prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.create({
          data: {
            businessId,
            channel,
            status: ConversationStatus.OPEN,
            contactIdentifier: data.contactIdentifier.trim(),
            contactName: data.contactName?.trim() || null,
            customerId: resolvedCustomerId,
            externalChatId: data.externalChatId || null,
            lastMessageAt: new Date(),
            lastMessageSnippet: snippet,
            unreadCount: senderType === MessageSenderType.CUSTOMER ? 1 : 0,
            messages: {
              create: {
                senderType,
                senderName:
                  senderType === MessageSenderType.SELLER
                    ? "Merchant"
                    : data.contactName || data.contactIdentifier,
                content: data.initialMessage,
                messageType: MessageType.TEXT,
              },
            },
          },
          include: {
            customer: true,
            messages: true,
          },
        });

        return conversation;
      });
    },

    updateConversation: async (
      id: string,
      data: {
        status?: ConversationStatus;
        customerId?: string | null;
        contactName?: string | null;
        internalNotes?: string | null;
        extractedOrderData?: any;
        unreadCount?: number;
      }
    ) => {
      // Assert conversation belongs to business
      const existing = await prisma.conversation.findFirst({
        where: { id, businessId },
      });
      if (!existing) {
        throw new TenantAccessError("Conversation not found in current workspace");
      }

      return prisma.conversation.update({
        where: { id },
        data: {
          ...(data.status ? { status: data.status } : {}),
          ...(data.customerId !== undefined ? { customerId: data.customerId } : {}),
          ...(data.contactName !== undefined ? { contactName: data.contactName } : {}),
          ...(data.internalNotes !== undefined ? { internalNotes: data.internalNotes } : {}),
          ...(data.extractedOrderData !== undefined
            ? { extractedOrderData: data.extractedOrderData }
            : {}),
          ...(data.unreadCount !== undefined ? { unreadCount: data.unreadCount } : {}),
        },
        include: {
          customer: true,
        },
      });
    },

    addMessage: async (
      conversationId: string,
      data: {
        content: string;
        senderType?: MessageSenderType;
        senderName?: string | null;
        messageType?: MessageType;
        mediaUrl?: string | null;
        mediaType?: string | null;
        externalMessageId?: string | null;
        metadata?: any;
      }
    ) => {
      // Assert conversation belongs to business
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, businessId },
      });
      if (!conversation) {
        throw new TenantAccessError("Conversation not found in current workspace");
      }

      const senderType = data.senderType ?? MessageSenderType.SELLER;
      const snippet = data.content.slice(0, 120);

      const message = await prisma.message.create({
        data: {
          conversationId,
          senderType,
          senderName: data.senderName || (senderType === MessageSenderType.SELLER ? "Merchant" : "Customer"),
          content: data.content,
          messageType: data.messageType ?? MessageType.TEXT,
          mediaUrl: data.mediaUrl || null,
          mediaType: data.mediaType || null,
          externalMessageId: data.externalMessageId || null,
          metadata: data.metadata || Prisma.JsonNull,
        },
      });

      // Update conversation metadata
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          lastMessageSnippet: snippet,
          ...(senderType === MessageSenderType.CUSTOMER
            ? { unreadCount: { increment: 1 } }
            : { unreadCount: 0 }),
        },
      });

      return message;
    },

    extractOrderFromConversation: async (
      conversationId: string,
      textOverride?: string
    ) => {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, businessId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          orders: { select: { id: true, orderNumber: true }, take: 1 },
        },
      });

      if (!conv) {
        throw new TenantAccessError("Conversation not found in current workspace");
      }

      // Fetch active catalog products and variants
      const catalog = await prisma.product.findMany({
        where: { businessId, status: ProductStatus.ACTIVE },
        include: { variants: true },
      });

      const catalogItems = catalog.map((p) => ({
        id: p.id,
        businessId: p.businessId,
        title: p.title,
        sku: p.sku,
        category: p.category,
        description: p.description,
        price: Number(p.price),
        costPrice: p.costPrice ? Number(p.costPrice) : null,
        stockQuantity: p.stockQuantity,
        lowStockThreshold: p.lowStockThreshold,
        trackInventory: p.trackInventory,
        status: p.status,
        variants: p.variants.map((v) => ({
          id: v.id,
          productId: v.productId,
          title: v.title,
          sku: v.sku,
          price: Number(v.price),
          costPrice: v.costPrice ? Number(v.costPrice) : null,
          stockQuantity: v.stockQuantity,
        })),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));

      const messagesInput = textOverride
        ? [{ senderType: MessageSenderType.CUSTOMER, content: textOverride }]
        : conv.messages.map((m) => ({
            senderType: m.senderType,
            content: m.content,
            mediaUrl: m.mediaUrl,
            messageType: m.messageType,
          }));

      const existingOrder = conv.orders.length > 0 ? conv.orders[0] : null;

      const extracted = extractOrderDetails(messagesInput, catalogItems, {
        existingOrder,
        contactName: conv.contactName,
        contactIdentifier: conv.contactIdentifier,
      });

      // Persist extraction result into conversation
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          extractedOrderData: extracted as any,
          ...(extracted.isComplete && conv.status === ConversationStatus.OPEN
            ? { status: ConversationStatus.PENDING_ORDER }
            : {}),
        },
      });

      return extracted;
    },

    createOrderFromConversation: async (
      conversationId: string,
      data: {
        customerId?: string | null;
        customerName: string;
        customerPhone?: string | null;
        customerEmail?: string | null;
        instagramHandle?: string | null;
        shippingAddress: string;
        city?: string | null;
        items: {
          productId?: string | null;
          variantId?: string | null;
          title: string;
          variantTitle?: string | null;
          sku?: string | null;
          quantity: number;
          unitPrice: number;
        }[];
        discount?: number;
        discountType?: string;
        shipping?: number;
        tax?: number;
        notes?: string | null;
        status?: OrderStatus;
        allowDuplicate?: boolean;
      }
    ) => {
      // 1. Verify conversation belongs to this tenant
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, businessId },
        include: {
          orders: { select: { id: true, orderNumber: true } },
          customer: true,
        },
      });

      if (!conversation) {
        throw new TenantAccessError("Conversation not found in current workspace");
      }

      // 2. Duplicate order prevention check
      if (conversation.orders.length > 0 && !data.allowDuplicate) {
        const existing = conversation.orders[0];
        throw new Error(
          `Duplicate order prevented: Order #${existing.orderNumber} already exists for this conversation. Enable "allowDuplicate" to override.`
        );
      }

      // 3. Resolve Customer (update existing or create new)
      let resolvedCustomerId = data.customerId || conversation.customerId || null;

      if (!resolvedCustomerId) {
        // Create new customer
        const newCustomer = await prisma.customer.create({
          data: {
            businessId,
            name: data.customerName,
            phone: data.customerPhone || (conversation.contactIdentifier.startsWith("+") ? conversation.contactIdentifier : null),
            email: data.customerEmail || null,
            instagramHandle: data.instagramHandle || (conversation.contactIdentifier.startsWith("@") ? conversation.contactIdentifier : null),
            address: data.shippingAddress,
            city: data.city || null,
          },
        });
        resolvedCustomerId = newCustomer.id;

        // Link customer to conversation
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { customerId: resolvedCustomerId },
        });
      } else {
        // Update existing customer address if provided
        await prisma.customer.update({
          where: { id: resolvedCustomerId },
          data: {
            name: data.customerName,
            ...(data.shippingAddress ? { address: data.shippingAddress } : {}),
            ...(data.city ? { city: data.city } : {}),
            ...(data.customerPhone ? { phone: data.customerPhone } : {}),
            ...(data.customerEmail ? { email: data.customerEmail } : {}),
            ...(data.instagramHandle ? { instagramHandle: data.instagramHandle } : {}),
          },
        });
      }

      // Map channel to order source
      const channelSourceMap: Record<ConversationChannel, OrderSource> = {
        [ConversationChannel.WHATSAPP]: OrderSource.WHATSAPP,
        [ConversationChannel.INSTAGRAM]: OrderSource.INSTAGRAM,
        [ConversationChannel.MANUAL]: OrderSource.MANUAL,
      };

      // 4. Create the Order with automatic calculations & stock deduction
      const order = await getTenantDb(businessId).createOrder({
        customerId: resolvedCustomerId,
        source: channelSourceMap[conversation.channel] || OrderSource.MANUAL,
        status: data.status || OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PENDING,
        discount: data.discount || 0,
        discountType: data.discountType || "FIXED",
        shipping: data.shipping || 0,
        tax: data.tax || 0,
        shippingAddress: data.shippingAddress,
        notes: data.notes || `Created via Unified Inbox from ${conversation.channel} conversation with ${data.customerName}`,
        conversationId,
        items: data.items,
      });

      // 5. Update conversation status to ORDER_CREATED
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          status: ConversationStatus.ORDER_CREATED,
        },
      });

      // 6. Append System Message to Conversation Thread
      await prisma.message.create({
        data: {
          conversationId,
          senderType: MessageSenderType.SYSTEM,
          senderName: "System",
          content: `🎉 Order #${order.orderNumber} successfully approved and created ($${order.totalAmount}). Status: ${order.status}.`,
          messageType: MessageType.TEXT,
        },
      });

      return order;
    },

    // -------------------------------------------------------------
    // Phase 4: Payment Management & Verification
    // -------------------------------------------------------------

    getPayments: async (paramsOrOrderId?: any) => {
        // Backward compatibility: if a string is passed, treat it as orderId
        const params = typeof paramsOrOrderId === 'string' ? { orderId: paramsOrOrderId } : (paramsOrOrderId || {});
        const page = Math.max(1, params?.page || 1);
        const limit = Math.min(100, Math.max(1, params?.limit || 20));
        const skip = (page - 1) * limit;

        const where: Prisma.PaymentWhereInput = { businessId };

        if (params?.orderId) where.orderId = params.orderId;
        if (params?.customerId) where.customerId = params.customerId;
        if (params?.status) where.status = params.status;
        if (params?.method) where.method = params.method;
        if (params?.search && typeof params.search === 'string' && params.search.trim()) {
          const query = params.search.trim();
          where.OR = [
            { referenceNumber: { contains: query, mode: "insensitive" } },
            { notes: { contains: query, mode: "insensitive" } },
            { order: { orderNumber: { contains: query, mode: "insensitive" } } },
            { customer: { name: { contains: query, mode: "insensitive" } } },
          ];
        }

        const [total, payments] = await Promise.all([
          prisma.payment.count({ where }),
          prisma.payment.findMany({
            where,
            include: {
              order: {
                select: {
                  orderNumber: true,
                  totalAmount: true,
                  amountPaid: true,
                },
              },
              customer: {
                select: {
                  name: true,
                  phone: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
          }),
        ]);

        return {
          items: payments.map((p) => ({
            id: p.id,
            businessId: p.businessId,
            orderId: p.orderId,
            customerId: p.customerId,
            amount: Number(p.amount),
            currency: p.currency,
            method: p.method,
            status: p.status,
            referenceNumber: p.referenceNumber,
            screenshotUrl: p.screenshotUrl,
            notes: p.notes,
            rejectionReason: p.rejectionReason,
            verifiedBy: p.verifiedBy,
            verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
            order: p.order
              ? {
                  orderNumber: p.order.orderNumber,
                  totalAmount: Number(p.order.totalAmount),
                  amountPaid: Number(p.order.amountPaid),
                }
              : undefined,
            customer: p.customer,
          })),
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        };
    },

    getPaymentById: async (id: string) => {
      const p = await prisma.payment.findFirst({
        where: { id, businessId },
        include: {
          order: {
            include: { customer: true },
          },
          customer: true,
        },
      });

      if (!p) return null;

      return {
        id: p.id,
        businessId: p.businessId,
        orderId: p.orderId,
        customerId: p.customerId,
        amount: Number(p.amount),
        currency: p.currency,
        method: p.method,
        status: p.status,
        referenceNumber: p.referenceNumber,
        screenshotUrl: p.screenshotUrl,
        notes: p.notes,
        rejectionReason: p.rejectionReason,
        verifiedBy: p.verifiedBy,
        verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        order: {
          orderNumber: p.order.orderNumber,
          totalAmount: Number(p.order.totalAmount),
          amountPaid: Number(p.order.amountPaid),
        },
        customer: p.customer,
      };
    },

    recordPayment: async (
      orderId: string,
      data: {
        amount: number;
        method?: PaymentMethod;
        referenceNumber?: string | null;
        screenshotUrl?: string | null;
        notes?: string | null;
        verifiedImmediately?: boolean;
      },
      verifiedByUserId?: string
    ) => {
      const order = await prisma.order.findFirst({
        where: { id: orderId, businessId },
      });

      if (!order) {
        throw new TenantAccessError("Order not found in current workspace");
      }

      const method = data.method || PaymentMethod.UPI;
      const isVerified = Boolean(data.verifiedImmediately);
      const initialStatus = isVerified
        ? PaymentRecordStatus.VERIFIED
        : PaymentRecordStatus.PENDING_VERIFICATION;

      return prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            businessId,
            orderId,
            customerId: order.customerId,
            amount: data.amount,
            currency: order.currency,
            method,
            status: initialStatus,
            referenceNumber: data.referenceNumber || null,
            screenshotUrl: data.screenshotUrl || null,
            notes: data.notes || null,
            verifiedBy: isVerified ? verifiedByUserId || "MERCHANT" : null,
            verifiedAt: isVerified ? new Date() : null,
          },
        });

        if (isVerified) {
          const currentPaid = Number(order.amountPaid || 0);
          const newPaid = Number((currentPaid + data.amount).toFixed(2));
          const totalAmount = Number(order.totalAmount);

          let newPaymentStatus: PaymentStatus = PaymentStatus.PENDING;
          if (newPaid >= totalAmount) {
            newPaymentStatus = PaymentStatus.PAID;
          } else if (newPaid > 0) {
            newPaymentStatus = PaymentStatus.PARTIALLY_PAID;
          }

          await tx.order.update({
            where: { id: orderId },
            data: {
              amountPaid: newPaid,
              paymentStatus: newPaymentStatus,
            },
          });

          if (order.customerId) {
            await tx.customer.update({
              where: { id: order.customerId },
              data: { totalSpent: { increment: data.amount } },
            });
          }

          await tx.auditLog.create({
            data: {
              businessId,
              userId: verifiedByUserId || null,
              action: "PAYMENT_RECORDED_AND_VERIFIED",
              entityType: "PAYMENT",
              entityId: payment.id,
              metadata: {
                orderId,
                amount: data.amount,
                method,
                newPaymentStatus,
                outstandingBalance: Math.max(0, totalAmount - newPaid),
              },
            },
          });
        } else {
          await tx.auditLog.create({
            data: {
              businessId,
              userId: verifiedByUserId || null,
              action: "PAYMENT_RECORDED_PENDING_VERIFICATION",
              entityType: "PAYMENT",
              entityId: payment.id,
              metadata: {
                orderId,
                amount: data.amount,
                method,
                screenshotUrl: data.screenshotUrl,
              },
            },
          });
        }

        return payment;
      });
    },

    verifyPayment: async (
      paymentId: string,
      data: {
        action: "VERIFY" | "REJECT";
        rejectionReason?: string | null;
        notes?: string | null;
      },
      verifiedByUserId?: string
    ) => {
      const payment = await prisma.payment.findFirst({
        where: { id: paymentId, businessId },
        include: { order: true },
      });

      if (!payment) {
        throw new TenantAccessError("Payment record not found in current workspace");
      }

      if (payment.status !== PaymentRecordStatus.PENDING_VERIFICATION) {
        throw new Error(`Cannot verify or reject payment in status: ${payment.status}`);
      }

      return prisma.$transaction(async (tx) => {
        if (data.action === "VERIFY") {
          const updatedPayment = await tx.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentRecordStatus.VERIFIED,
              verifiedBy: verifiedByUserId || "MERCHANT",
              verifiedAt: new Date(),
              notes: data.notes || payment.notes,
            },
          });

          const currentPaid = Number(payment.order.amountPaid || 0);
          const payAmount = Number(payment.amount);
          const newPaid = Number((currentPaid + payAmount).toFixed(2));
          const totalAmount = Number(payment.order.totalAmount);

          let newPaymentStatus: PaymentStatus = PaymentStatus.PENDING;
          if (newPaid >= totalAmount) {
            newPaymentStatus = PaymentStatus.PAID;
          } else if (newPaid > 0) {
            newPaymentStatus = PaymentStatus.PARTIALLY_PAID;
          }

          await tx.order.update({
            where: { id: payment.orderId },
            data: {
              amountPaid: newPaid,
              paymentStatus: newPaymentStatus,
            },
          });

          if (payment.customerId) {
            await tx.customer.update({
              where: { id: payment.customerId },
              data: { totalSpent: { increment: payAmount } },
            });
          }

          await tx.auditLog.create({
            data: {
              businessId,
              userId: verifiedByUserId || null,
              action: "PAYMENT_VERIFIED",
              entityType: "PAYMENT",
              entityId: paymentId,
              metadata: {
                orderId: payment.orderId,
                amount: payAmount,
                newPaymentStatus,
                outstandingBalance: Math.max(0, totalAmount - newPaid),
              },
            },
          });

          return updatedPayment;
        } else {
          // REJECT
          const updatedPayment = await tx.payment.update({
            where: { id: paymentId },
            data: {
              status: PaymentRecordStatus.REJECTED,
              rejectionReason: data.rejectionReason || "Payment screenshot or reference unverified",
              notes: data.notes || payment.notes,
              verifiedBy: verifiedByUserId || "MERCHANT",
              verifiedAt: new Date(),
            },
          });

          await tx.auditLog.create({
            data: {
              businessId,
              userId: verifiedByUserId || null,
              action: "PAYMENT_REJECTED",
              entityType: "PAYMENT",
              entityId: paymentId,
              metadata: {
                orderId: payment.orderId,
                rejectionReason: data.rejectionReason,
              },
            },
          });

          return updatedPayment;
        }
      });
    },

    // -------------------------------------------------------------
    // Phase 4: Delivery Management & Fulfillment
    // -------------------------------------------------------------

    getShipments: async (params?: {
      carrier?: DeliveryPartner;
      status?: ShipmentStatus;
      orderId?: string;
      search?: string;
      page?: number;
      limit?: number;
    }) => {
      const page = Math.max(1, params?.page || 1);
      const limit = Math.min(100, Math.max(1, params?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.ShipmentWhereInput = {
        businessId,
      };

      if (params?.carrier) where.carrier = params.carrier;
      if (params?.status) where.status = params.status;
      if (params?.orderId) where.orderId = params.orderId;
      if (params?.search && typeof params.search === "string" && params.search.trim()) {
        const query = params.search.trim();
        where.OR = [
          { trackingNumber: { contains: query, mode: "insensitive" } },
          { shippingAddress: { contains: query, mode: "insensitive" } },
          { city: { contains: query, mode: "insensitive" } },
          { order: { orderNumber: { contains: query, mode: "insensitive" } } },
        ];
      }

      const [total, shipments] = await Promise.all([
        prisma.shipment.count({ where }),
        prisma.shipment.findMany({
          where,
          include: {
            order: {
              select: {
                orderNumber: true,
                status: true,
                customer: {
                  select: {
                    name: true,
                    phone: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
      ]);

      return {
        items: shipments.map((s) => ({
          id: s.id,
          businessId: s.businessId,
          orderId: s.orderId,
          carrier: s.carrier,
          trackingNumber: s.trackingNumber,
          trackingUrl: s.trackingUrl,
          status: s.status,
          shippingAddress: s.shippingAddress,
          city: s.city,
          state: s.state,
          postalCode: s.postalCode,
          deliveryCharges: Number(s.deliveryCharges),
          estimatedDelivery: s.estimatedDelivery ? s.estimatedDelivery.toISOString() : null,
          actualDelivery: s.actualDelivery ? s.actualDelivery.toISOString() : null,
          failureReason: s.failureReason,
          notes: s.notes,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          order: s.order,
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },

    getShipmentById: async (id: string) => {
      const s = await prisma.shipment.findFirst({
        where: { id, businessId },
        include: {
          order: {
            include: { customer: true, items: true },
          },
        },
      });

      if (!s) return null;

      return {
        id: s.id,
        businessId: s.businessId,
        orderId: s.orderId,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
        trackingUrl: s.trackingUrl,
        status: s.status,
        shippingAddress: s.shippingAddress,
        city: s.city,
        state: s.state,
        postalCode: s.postalCode,
        deliveryCharges: Number(s.deliveryCharges),
        estimatedDelivery: s.estimatedDelivery ? s.estimatedDelivery.toISOString() : null,
        actualDelivery: s.actualDelivery ? s.actualDelivery.toISOString() : null,
        failureReason: s.failureReason,
        notes: s.notes,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        order: {
          orderNumber: s.order.orderNumber,
          status: s.order.status,
          customer: s.order.customer,
        },
      };
    },

    createShipment: async (
      orderId: string,
      data: {
        carrier?: DeliveryPartner;
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
    ) => {
      const order = await prisma.order.findFirst({
        where: { id: orderId, businessId },
      });

      if (!order) {
        throw new TenantAccessError("Order not found in current workspace");
      }

      const carrier = data.carrier || DeliveryPartner.MANUAL;
      const initialStatus = data.status || ShipmentStatus.PENDING;
      const destination = data.shippingAddress || order.shippingAddress || "Customer Address";

      return prisma.$transaction(async (tx) => {
        const shipment = await tx.shipment.create({
          data: {
            businessId,
            orderId,
            carrier,
            trackingNumber: data.trackingNumber || null,
            trackingUrl: data.trackingUrl || null,
            status: initialStatus,
            shippingAddress: destination,
            city: data.city || null,
            state: data.state || null,
            postalCode: data.postalCode || null,
            deliveryCharges: data.deliveryCharges || 0,
            estimatedDelivery: data.estimatedDelivery ? new Date(data.estimatedDelivery) : null,
            notes: data.notes || null,
          },
        });

        // If status is dispatched or in-transit, advance order status to SHIPPED
        if (
          initialStatus === ShipmentStatus.DISPATCHED ||
          initialStatus === ShipmentStatus.IN_TRANSIT
        ) {
          await tx.order.update({
            where: { id: orderId },
            data: { status: OrderStatus.SHIPPED },
          });
        }

        await tx.auditLog.create({
          data: {
            businessId,
            action: "SHIPMENT_CREATED",
            entityType: "SHIPMENT",
            entityId: shipment.id,
            metadata: {
              orderId,
              carrier,
              trackingNumber: data.trackingNumber,
              status: initialStatus,
            },
          },
        });

        return shipment;
      });
    },

    updateShipmentStatus: async (
      shipmentId: string,
      data: {
        status: ShipmentStatus;
        failureReason?: string | null;
        notes?: string | null;
      }
    ) => {
      const shipment = await prisma.shipment.findFirst({
        where: { id: shipmentId, businessId },
        include: { order: { include: { items: true } } },
      });

      if (!shipment) {
        throw new TenantAccessError("Shipment not found in current workspace");
      }

      return prisma.$transaction(async (tx) => {
        const isDelivered = data.status === ShipmentStatus.DELIVERED;
        const isRto = data.status === ShipmentStatus.RETURNED_TO_ORIGIN;
        const isCancelled = data.status === ShipmentStatus.CANCELLED;

        const updated = await tx.shipment.update({
          where: { id: shipmentId },
          data: {
            status: data.status,
            failureReason: data.failureReason || null,
            notes: data.notes || shipment.notes,
            ...(isDelivered ? { actualDelivery: new Date() } : {}),
          },
        });

        // Automatic order transition
        if (isDelivered) {
          await tx.order.update({
            where: { id: shipment.orderId },
            data: { status: OrderStatus.DELIVERED },
          });
        } else if (
          data.status === ShipmentStatus.DISPATCHED ||
          data.status === ShipmentStatus.IN_TRANSIT
        ) {
          await tx.order.update({
            where: { id: shipment.orderId },
            data: { status: OrderStatus.SHIPPED },
          });
        } else if (isRto || isCancelled) {
          // Automatic cancellation and inventory restoration workflow
          await tx.order.update({
            where: { id: shipment.orderId },
            data: { status: OrderStatus.CANCELLED },
          });

          if (shipment.order.stockDeducted) {
            for (const item of shipment.order.items) {
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
              where: { id: shipment.orderId },
              data: { stockDeducted: false },
            });
          }
        }

        await tx.auditLog.create({
          data: {
            businessId,
            action: `SHIPMENT_STATUS_${data.status}`,
            entityType: "SHIPMENT",
            entityId: shipmentId,
            metadata: {
              previousStatus: shipment.status,
              newStatus: data.status,
              failureReason: data.failureReason,
            },
          },
        });

        return updated;
      });
    },

    // -------------------------------------------------------------
    // Phase 4: Business Automation & Notification Queries
    // -------------------------------------------------------------

    getNotifications: async (params?: {
      channel?: string;
      status?: NotificationStatus;
      limit?: number;
    }) => {
      const limit = Math.min(100, params?.limit || 50);
      const where: Prisma.NotificationWhereInput = { businessId };
      if (params?.channel) where.channel = params.channel;
      if (params?.status) where.status = params.status;

      return prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    },

    getAutomationJobs: async (params?: { status?: JobStatus; limit?: number }) => {
      const limit = Math.min(100, params?.limit || 50);
      const where: Prisma.AutomationJobWhereInput = { businessId };
      if (params?.status) where.status = params.status;

      return prisma.automationJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    },

    runAutomationQueue: async () => {
      return processPendingAutomationJobs(businessId);
    },

    // -------------------------------------------------------------
    // Phase 5: Analytics, Subscriptions & Team Management
    // -------------------------------------------------------------
    getRevenueAnalytics: async (filter?: DateRangeFilter) => {
      return getBusinessRevenueAnalytics(businessId, filter);
    },

    getProductPerformance: async () => {
      return getBusinessProductPerformance(businessId);
    },

    getCustomerRetention: async () => {
      return getBusinessCustomerRetention(businessId);
    },

    getPaymentReport: async () => {
      return getBusinessPaymentReport(businessId);
    },

    getSubscriptionUsage: async () => {
      return getSubscriptionUsage(businessId);
    },

    updateSubscriptionPlan: async (newPlan: SubscriptionPlan) => {
      return updateSubscriptionPlan(businessId, newPlan);
    },

    inviteTeamMember: async (inviterUserId: string, email: string, role?: MemberRole) => {
      return inviteTeamMember(businessId, inviterUserId, email, role);
    },

    getInvitations: async () => {
      return getBusinessInvitations(businessId);
    },

    revokeInvitation: async (invitationId: string, requesterUserId: string) => {
      return revokeInvitation(businessId, invitationId, requesterUserId);
    },

    updateMemberRole: async (memberId: string, newRole: MemberRole, requesterUserId: string) => {
      return updateMemberRole(businessId, memberId, newRole, requesterUserId);
    },

    removeMember: async (memberId: string, requesterUserId: string) => {
      return removeTeamMember(businessId, memberId, requesterUserId);
    },

    getAuditLogs: async (params?: { page?: number; limit?: number; action?: string }) => {
      const page = Math.max(1, params?.page || 1);
      const limit = Math.min(100, Math.max(1, params?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.AuditLogWhereInput = { businessId };
      if (params?.action) where.action = params.action;

      const [total, items] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
          where,
          include: {
            user: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
      ]);

      return {
        items: items.map((log) => ({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          metadata: log.metadata,
          userName: log.user?.name || "System",
          userEmail: log.user?.email || null,
          createdAt: log.createdAt.toISOString(),
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  };
}
