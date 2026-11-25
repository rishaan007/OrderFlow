import { NextRequest } from "next/server";
import { OrderSource, OrderStatus, PaymentStatus, SocialPlatform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTenantDb } from "@/lib/tenant";
import {
  dispatchDeveloperWebhookEvent,
  withDeveloperApi,
} from "@/lib/developer-platform";
import { apiV1CreateOrderSchema } from "@/lib/validations";
import { ValidationError } from "@/lib/errors";
import { toMinorUnits } from "@/lib/money";
import { calculateOrderTotalSnapshot, snapshotToOrderDecimals } from "@/lib/tax";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/orders", "orders:read", async (ctx) => {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));
    const status = (searchParams.get("status") as OrderStatus) || undefined;
    const paymentStatus = (searchParams.get("paymentStatus") as PaymentStatus) || undefined;
    const source = (searchParams.get("source") as OrderSource) || undefined;
    const customerId = searchParams.get("customerId") || undefined;
    const search = searchParams.get("search") || undefined;

    const tenantDb = getTenantDb(ctx.businessId);
    const result = await tenantDb.getOrders({
      search,
      status,
      paymentStatus,
      source,
      customerId,
      isSandbox: ctx.isSandbox,
      page,
      limit,
    });

    return {
      status: 200,
      body: {
        success: true,
        environment: ctx.environment,
        data: result,
      },
    };
  });
}

export async function POST(req: NextRequest) {
  return withDeveloperApi(req, "/api/v1/orders", "orders:write", async (ctx) => {
    const body = await req.json();
    const parsed = apiV1CreateOrderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.errors[0]?.message || "Invalid order payload",
        parsed.error.flatten()
      );
    }

    const input = parsed.data;
    const headerIdemKey = req.headers.get("idempotency-key")?.trim();
    const idemKey = headerIdemKey || input.idempotencyKey || null;
    const tenantDb = getTenantDb(ctx.businessId);

    if (idemKey) {
      const externalEventId = `${ctx.businessId}:${ctx.environment}:v1_order:${idemKey}`;
      const existingEvent = await prisma.socialEvent.findUnique({
        where: {
          provider_externalEventId: {
            provider: SocialPlatform.API,
            externalEventId,
          },
        },
      });
      const existingOrderId = (existingEvent?.payload as any)?.orderId as string | undefined;
      if (existingOrderId) {
        const existingOrder = await tenantDb.getOrderById(existingOrderId, {
          isSandbox: ctx.isSandbox,
        });
        if (existingOrder) {
          return {
            status: 200,
            body: {
              success: true,
              deduplicated: true,
              environment: ctx.environment,
              data: existingOrder,
            },
          };
        }
      }
    }

    const business = await prisma.business.findUnique({
      where: { id: ctx.businessId },
      select: { currency: true, countryCode: true },
    });
    const currency = business?.currency || "USD";

    const subtotalMinorUnits = input.items.reduce(
      (sum, item) => sum + toMinorUnits(item.unitPrice, currency) * item.quantity,
      0
    );
    const discountMinorUnits =
      input.discountType === "PERCENTAGE"
        ? Math.min(subtotalMinorUnits, Math.round((subtotalMinorUnits * input.discount) / 100))
        : Math.min(subtotalMinorUnits, toMinorUnits(input.discount, currency));
    const shippingMinorUnits = toMinorUnits(input.shipping, currency);
    const explicitTaxMinorUnits =
      input.tax !== undefined ? toMinorUnits(input.tax, currency) : undefined;

    const snapshot = await calculateOrderTotalSnapshot({
      subtotalMinorUnits,
      discountMinorUnits,
      shippingMinorUnits,
      feesMinorUnits: 0,
      currency,
      countryCode: input.countryCode ?? business?.countryCode ?? null,
      stateCode: input.stateCode ?? null,
      businessId: ctx.businessId,
      explicitTaxMinorUnits,
    });
    const snapshotDecimals = snapshotToOrderDecimals(snapshot);

    const order = await tenantDb.createOrder({
      customerId: input.customerId ?? null,
      newCustomer: input.newCustomer ?? null,
      source: OrderSource.API,
      status: input.status as OrderStatus,
      discount: input.discount,
      discountType: input.discountType,
      shipping: Number(snapshotDecimals.shipping),
      tax: Number(snapshotDecimals.tax),
      feesMinorUnits: snapshotDecimals.feesMinorUnits,
      totalSnapshot: snapshotDecimals.totalSnapshot,
      taxBreakdown: snapshotDecimals.taxBreakdown,
      isSandbox: ctx.isSandbox,
      shippingAddress: input.shippingAddress ?? null,
      notes: input.notes ?? null,
      customerNotes: input.customerNotes ?? null,
      items: input.items,
    });

    if (idemKey) {
      const externalEventId = `${ctx.businessId}:${ctx.environment}:v1_order:${idemKey}`;
      await prisma.socialEvent
        .create({
          data: {
            businessId: ctx.businessId,
            provider: SocialPlatform.API,
            externalEventId,
            eventType: "ORDER_EVENT",
            status: "PROCESSED",
            processedAt: new Date(),
            payload: { orderId: order.id, environment: ctx.environment } as Prisma.InputJsonValue,
          },
        })
        .catch(() => {});
    }

    await dispatchDeveloperWebhookEvent(
      {
        businessId: ctx.businessId,
        eventType: "order.created",
        environment: ctx.environment,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          totalAmount: Number(order.totalAmount),
          currency: order.currency,
          isSandbox: ctx.isSandbox,
        },
      },
      { deliverImmediately: false }
    ).catch(() => {});

    return {
      status: 201,
      body: {
        success: true,
        environment: ctx.environment,
        data: order,
      },
    };
  });
}
