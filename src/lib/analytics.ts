// Real-time Analytics & Business Intelligence Engine
// All calculations are performed directly from actual PostgreSQL database records

import { prisma } from "./prisma";
import { OrderStatus, PaymentRecordStatus, OrderSource, PaymentMethod } from "@prisma/client";

export interface DateRangeFilter {
  startDate?: Date;
  endDate?: Date;
  days?: number; // e.g. 7, 30, 90
}

export interface RevenueAnalytics {
  grossRevenue: number;
  netRevenue: number;
  totalOrders: number;
  completedOrders: number;
  pendingOrders: number;
  cancelledOrders: number;
  averageOrderValue: number;
  currency: string;
  timeSeries: Array<{
    date: string;
    revenue: number;
    orders: number;
  }>;
  channelBreakdown: Array<{
    channel: OrderSource;
    revenue: number;
    orders: number;
    percentage: number;
  }>;
}

export interface ProductPerformance {
  topProducts: Array<{
    id: string;
    title: string;
    sku: string | null;
    unitsSold: number;
    revenue: number;
    currentStock: number;
  }>;
  inventorySummary: {
    totalProducts: number;
    totalStockUnits: number;
    lowStockCount: number;
    outOfStockCount: number;
    totalRetailValue: number;
    totalCostValue: number;
  };
}

export interface CustomerRetentionMetrics {
  totalCustomers: number;
  newCustomers: number;
  repeatCustomers: number;
  repeatCustomerRate: number; // percentage
  averageLifetimeValue: number;
  topCustomers: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    ordersCount: number;
    totalSpent: number;
    lastOrderDate?: string | null;
  }>;
  inactiveCustomersCount: number; // no orders in > 60 days
}

export interface PaymentReport {
  totalCollected: number;
  pendingVerification: number;
  rejectedAmount: number;
  totalOutstanding: number;
  currency: string;
  methodDistribution: Array<{
    method: PaymentMethod;
    amount: number;
    count: number;
    percentage: number;
  }>;
  outstandingOrders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    customerPhone: string | null;
    orderDate: string;
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
    status: OrderStatus;
  }>;
}

export async function getBusinessRevenueAnalytics(
  businessId: string,
  filter: DateRangeFilter = { days: 30 }
): Promise<RevenueAnalytics> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { currency: true },
  });
  const currency = business?.currency || "USD";

  const now = new Date();
  const days = filter.days ?? 30;
  const startDate = filter.startDate ?? new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const endDate = filter.endDate ?? now;

  // Query actual orders within period (excluding sandbox transactions)
  const orders = await prisma.order.findMany({
    where: {
      businessId,
      isSandbox: false,
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      id: true,
      totalAmount: true,
      subtotal: true,
      discount: true,
      tax: true,
      shipping: true,
      status: true,
      source: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let grossRevenue = 0;
  let netRevenue = 0;
  let completedOrders = 0;
  let pendingOrders = 0;
  let cancelledOrders = 0;

  const channelMap = new Map<OrderSource, { revenue: number; orders: number }>();
  for (const src of Object.values(OrderSource)) {
    channelMap.set(src, { revenue: 0, orders: 0 });
  }

  // Pre-populate daily time series
  const timeSeriesMap = new Map<string, { revenue: number; orders: number }>();
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const key = currentDate.toISOString().split("T")[0];
    timeSeriesMap.set(key, { revenue: 0, orders: 0 });
    currentDate.setDate(currentDate.getDate() + 1);
  }

  for (const order of orders) {
    const total = Number(order.totalAmount);
    const subtotal = Number(order.subtotal);
    const discount = Number(order.discount);
    const dateKey = order.createdAt.toISOString().split("T")[0];

    if (order.status === OrderStatus.CANCELLED) {
      cancelledOrders += 1;
      continue;
    }

    grossRevenue += total;
    netRevenue += Math.max(0, subtotal - discount);

    if (order.status === OrderStatus.DELIVERED) {
      completedOrders += 1;
    } else {
      pendingOrders += 1;
    }

    // Channel attribution
    const ch = channelMap.get(order.source) || { revenue: 0, orders: 0 };
    ch.revenue += total;
    ch.orders += 1;
    channelMap.set(order.source, ch);

    // Time series
    if (timeSeriesMap.has(dateKey)) {
      const ts = timeSeriesMap.get(dateKey)!;
      ts.revenue += total;
      ts.orders += 1;
    } else {
      timeSeriesMap.set(dateKey, { revenue: total, orders: 1 });
    }
  }

  const activeOrdersCount = orders.length - cancelledOrders;
  const aov = activeOrdersCount > 0 ? Math.round((grossRevenue / activeOrdersCount) * 100) / 100 : 0;

  const channelBreakdown = Array.from(channelMap.entries()).map(([channel, data]) => ({
    channel,
    revenue: Math.round(data.revenue * 100) / 100,
    orders: data.orders,
    percentage: grossRevenue > 0 ? Math.round((data.revenue / grossRevenue) * 1000) / 10 : 0,
  }));

  const timeSeries = Array.from(timeSeriesMap.entries()).map(([date, data]) => ({
    date,
    revenue: Math.round(data.revenue * 100) / 100,
    orders: data.orders,
  }));

  return {
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    netRevenue: Math.round(netRevenue * 100) / 100,
    totalOrders: orders.length,
    completedOrders,
    pendingOrders,
    cancelledOrders,
    averageOrderValue: aov,
    currency,
    timeSeries,
    channelBreakdown,
  };
}

export async function getBusinessProductPerformance(businessId: string): Promise<ProductPerformance> {
  const [products, orderItems] = await Promise.all([
    prisma.product.findMany({
      where: { businessId },
      include: { variants: true },
    }),
    prisma.orderItem.findMany({
      where: {
        order: {
          businessId,
          isSandbox: false,
          status: { not: OrderStatus.CANCELLED },
        },
      },
      select: {
        productId: true,
        title: true,
        sku: true,
        quantity: true,
        totalPrice: true,
      },
    }),
  ]);

  // Aggregate sales by product
  const productSalesMap = new Map<string, { title: string; sku: string | null; unitsSold: number; revenue: number }>();

  for (const item of orderItems) {
    const key = item.productId || item.title;
    const existing = productSalesMap.get(key) || {
      title: item.title,
      sku: item.sku,
      unitsSold: 0,
      revenue: 0,
    };
    existing.unitsSold += item.quantity;
    existing.revenue += Number(item.totalPrice);
    productSalesMap.set(key, existing);
  }

  const productLookup = new Map<string, any>(products.map((p) => [p.id, p]));

  const topProducts = Array.from(productSalesMap.entries())
    .map(([id, data]) => {
      const p = productLookup.get(id);
      return {
        id,
        title: data.title,
        sku: data.sku || p?.sku || null,
        unitsSold: data.unitsSold,
        revenue: Math.round(data.revenue * 100) / 100,
        currentStock: p ? p.stockQuantity : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Inventory valuation & health
  let totalStockUnits = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let totalRetailValue = 0;
  let totalCostValue = 0;

  for (const p of products) {
    totalStockUnits += p.stockQuantity;
    if (p.stockQuantity === 0) {
      outOfStockCount += 1;
    } else if (p.stockQuantity <= p.lowStockThreshold) {
      lowStockCount += 1;
    }

    const price = Number(p.price);
    const cost = p.costPrice ? Number(p.costPrice) : price * 0.6; // fallback 60% margin if unrecorded
    totalRetailValue += price * p.stockQuantity;
    totalCostValue += cost * p.stockQuantity;
  }

  return {
    topProducts,
    inventorySummary: {
      totalProducts: products.length,
      totalStockUnits,
      lowStockCount,
      outOfStockCount,
      totalRetailValue: Math.round(totalRetailValue * 100) / 100,
      totalCostValue: Math.round(totalCostValue * 100) / 100,
    },
  };
}

export async function getBusinessCustomerRetention(businessId: string): Promise<CustomerRetentionMetrics> {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [customers, newCustomersCount] = await Promise.all([
    prisma.customer.findMany({
      where: { businessId },
      include: {
        orders: {
          where: { status: { not: OrderStatus.CANCELLED } },
          select: { totalAmount: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    prisma.customer.count({
      where: {
        businessId,
        createdAt: { gte: thirtyDaysAgo },
      },
    }),
  ]);

  let repeatCustomers = 0;
  let totalSpentSum = 0;
  let inactiveCustomersCount = 0;

  const enrichedCustomers = customers.map((c) => {
    const ordersVolume = c.orders.reduce((acc, o) => acc + Number(o.totalAmount), 0);
    const effectiveSpent = Math.max(Number(c.totalSpent), ordersVolume);
    const effectiveOrdersCount = Math.max(c.ordersCount, c.orders.length);

    totalSpentSum += effectiveSpent;

    if (effectiveOrdersCount > 1) {
      repeatCustomers += 1;
    }

    const lastOrder = c.orders[0]?.createdAt;
    if (!lastOrder || lastOrder < sixtyDaysAgo) {
      inactiveCustomersCount += 1;
    }

    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      ordersCount: effectiveOrdersCount,
      totalSpent: Math.round(effectiveSpent * 100) / 100,
      lastOrderDate: lastOrder ? lastOrder.toISOString() : null,
    };
  });

  enrichedCustomers.sort((a, b) => b.totalSpent - a.totalSpent);

  const totalCustomers = customers.length;
  const repeatCustomerRate = totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 1000) / 10 : 0;
  const averageLifetimeValue = totalCustomers > 0 ? Math.round((totalSpentSum / totalCustomers) * 100) / 100 : 0;

  return {
    totalCustomers,
    newCustomers: newCustomersCount,
    repeatCustomers,
    repeatCustomerRate,
    averageLifetimeValue,
    topCustomers: enrichedCustomers.slice(0, 10),
    inactiveCustomersCount,
  };
}

export async function getBusinessPaymentReport(businessId: string): Promise<PaymentReport> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { currency: true },
  });
  const currency = business?.currency || "USD";

  const [payments, orders] = await Promise.all([
    prisma.payment.findMany({
      where: { businessId },
      select: {
        amount: true,
        status: true,
        method: true,
      },
    }),
    prisma.order.findMany({
      where: {
        businessId,
        isSandbox: false,
        status: { not: OrderStatus.CANCELLED },
      },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        amountPaid: true,
        status: true,
        createdAt: true,
        customer: {
          select: {
            name: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  let totalCollected = 0;
  let pendingVerification = 0;
  let rejectedAmount = 0;

  const methodMap = new Map<PaymentMethod, { amount: number; count: number }>();
  for (const m of Object.values(PaymentMethod)) {
    methodMap.set(m, { amount: 0, count: 0 });
  }

  for (const p of payments) {
    const amt = Number(p.amount);
    if (p.status === PaymentRecordStatus.VERIFIED) {
      totalCollected += amt;
      const m = methodMap.get(p.method) || { amount: 0, count: 0 };
      m.amount += amt;
      m.count += 1;
      methodMap.set(p.method, m);
    } else if (p.status === PaymentRecordStatus.PENDING_VERIFICATION) {
      pendingVerification += amt;
    } else if (p.status === PaymentRecordStatus.REJECTED) {
      rejectedAmount += amt;
    }
  }

  let totalOutstanding = 0;
  const outstandingOrders: PaymentReport["outstandingOrders"] = [];

  for (const order of orders) {
    const total = Number(order.totalAmount);
    const paid = Number(order.amountPaid);
    const due = Math.max(0, total - paid);

    if (due > 0.01) {
      totalOutstanding += due;
      outstandingOrders.push({
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customer?.name || "Direct Guest",
        customerPhone: order.customer?.phone || null,
        orderDate: order.createdAt.toISOString(),
        totalAmount: total,
        amountPaid: paid,
        balanceDue: Math.round(due * 100) / 100,
        status: order.status,
      });
    }
  }

  const methodDistribution = Array.from(methodMap.entries()).map(([method, data]) => ({
    method,
    amount: Math.round(data.amount * 100) / 100,
    count: data.count,
    percentage: totalCollected > 0 ? Math.round((data.amount / totalCollected) * 1000) / 10 : 0,
  }));

  return {
    totalCollected: Math.round(totalCollected * 100) / 100,
    pendingVerification: Math.round(pendingVerification * 100) / 100,
    rejectedAmount: Math.round(rejectedAmount * 100) / 100,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    currency,
    methodDistribution,
    outstandingOrders,
  };
}
