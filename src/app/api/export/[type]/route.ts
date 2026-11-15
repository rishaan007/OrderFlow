import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { generateCsv, createCsvResponse } from "@/lib/csv-export";
import { handleApiError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limiter";
import { logAuditEvent } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const rateLimit = checkRateLimit(req, { limit: 20, windowMs: 60000, keyPrefix: "export" });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Export rate limit exceeded. Please wait a minute." },
        { status: 429, headers: rateLimit.headers }
      );
    }

    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthenticated" }, { status: 401 });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json({ success: false, error: "No active business found" }, { status: 404 });
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const exportType = params.type.toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    await logAuditEvent(businessId, session.user.id, "CSV_EXPORT", "EXPORT", null, {
      type: exportType,
    });

    switch (exportType) {
      case "orders": {
        const orders = await prisma.order.findMany({
          where: { businessId },
          include: {
            customer: { select: { name: true, phone: true, email: true } },
            items: true,
          },
          orderBy: { createdAt: "desc" },
        });

        const headers = [
          "Order ID",
          "Order Number",
          "Date",
          "Customer Name",
          "Customer Phone",
          "Customer Email",
          "Source",
          "Status",
          "Payment Status",
          "Items Count",
          "Currency",
          "Subtotal",
          "Discount",
          "Shipping",
          "Tax",
          "Total Amount",
          "Amount Paid",
          "Balance Due",
          "Shipping Address",
        ];

        const rows = orders.map((o) => {
          const total = Number(o.totalAmount);
          const paid = Number(o.amountPaid);
          const due = Math.max(0, total - paid);
          const itemsCount = o.items.reduce((acc, i) => acc + i.quantity, 0);

          return [
            o.id,
            o.orderNumber,
            o.createdAt.toISOString(),
            o.customer?.name || "Guest",
            o.customer?.phone || "",
            o.customer?.email || "",
            o.source,
            o.status,
            o.paymentStatus,
            itemsCount,
            o.currency,
            Number(o.subtotal),
            Number(o.discount),
            Number(o.shipping),
            Number(o.tax),
            total,
            paid,
            due,
            o.shippingAddress || "",
          ];
        });

        const csv = generateCsv(headers, rows);
        return createCsvResponse(csv, `orders-export-${timestamp}.csv`);
      }

      case "products": {
        const products = await prisma.product.findMany({
          where: { businessId },
          include: { variants: true },
          orderBy: { createdAt: "desc" },
        });

        const headers = [
          "Product ID",
          "Title",
          "SKU",
          "Category",
          "Status",
          "Price",
          "Cost Price",
          "Stock Quantity",
          "Low Stock Threshold",
          "Track Inventory",
          "Variants Count",
          "Total Inventory Value",
          "Created At",
        ];

        const rows = products.map((p) => {
          const price = Number(p.price);
          const cost = p.costPrice ? Number(p.costPrice) : "";
          const valuation = price * p.stockQuantity;

          return [
            p.id,
            p.title,
            p.sku || "",
            p.category || "",
            p.status,
            price,
            cost,
            p.stockQuantity,
            p.lowStockThreshold,
            p.trackInventory ? "Yes" : "No",
            p.variants.length,
            valuation,
            p.createdAt.toISOString(),
          ];
        });

        const csv = generateCsv(headers, rows);
        return createCsvResponse(csv, `products-export-${timestamp}.csv`);
      }

      case "customers": {
        const customers = await prisma.customer.findMany({
          where: { businessId },
          orderBy: { totalSpent: "desc" },
        });

        const headers = [
          "Customer ID",
          "Name",
          "Phone",
          "Email",
          "Instagram Handle",
          "City",
          "Orders Count",
          "Total Spent",
          "Tags",
          "Address",
          "Notes",
          "Created At",
        ];

        const rows = customers.map((c) => [
          c.id,
          c.name,
          c.phone || "",
          c.email || "",
          c.instagramHandle || "",
          c.city || "",
          c.ordersCount,
          Number(c.totalSpent),
          c.tags.join("; "),
          c.address || "",
          c.notes || "",
          c.createdAt.toISOString(),
        ]);

        const csv = generateCsv(headers, rows);
        return createCsvResponse(csv, `customers-export-${timestamp}.csv`);
      }

      case "payments": {
        const payments = await prisma.payment.findMany({
          where: { businessId },
          include: {
            order: { select: { orderNumber: true } },
            customer: { select: { name: true, phone: true } },
          },
          orderBy: { createdAt: "desc" },
        });

        const headers = [
          "Payment ID",
          "Order Number",
          "Customer Name",
          "Customer Phone",
          "Amount",
          "Currency",
          "Method",
          "Status",
          "Reference Number",
          "Verified By",
          "Verified At",
          "Notes",
          "Created At",
        ];

        const rows = payments.map((p) => [
          p.id,
          p.order?.orderNumber || "",
          p.customer?.name || "Direct Guest",
          p.customer?.phone || "",
          Number(p.amount),
          p.currency,
          p.method,
          p.status,
          p.referenceNumber || "",
          p.verifiedBy || "",
          p.verifiedAt ? p.verifiedAt.toISOString() : "",
          p.notes || "",
          p.createdAt.toISOString(),
        ]);

        const csv = generateCsv(headers, rows);
        return createCsvResponse(csv, `payments-export-${timestamp}.csv`);
      }

      default:
        return NextResponse.json(
          {
            success: false,
            error: `Invalid export type: '${exportType}'. Valid types: orders, products, customers, payments`,
          },
          { status: 400 }
        );
    }
  } catch (error) {
    return handleApiError(error, { action: "CSV_EXPORT" });
  }
}
