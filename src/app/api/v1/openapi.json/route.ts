import { NextResponse } from "next/server";

/**
 * Machine-readable OpenAPI 3.1 Specification for OrderFlow Network Developer API v1
 */
export async function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "OrderFlow Network Developer API",
      version: "1.0.0",
      description:
        "Versioned commerce orchestration API for orders, products, social transactions, payments, shipments, webhooks, and analytics. Strictly isolated by tenant and environment (SANDBOX vs LIVE).",
    },
    servers: [{ url: "/api/v1", description: "Version 1 Production & Sandbox API" }],
    security: [{ BearerApiKey: [] }],
    components: {
      securitySchemes: {
        BearerApiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "OrderFlow API Key (of_live_sk_... or of_test_sk_...)",
          description:
            "Provide API key via `Authorization: Bearer <key>` or `x-orderflow-api-key: <key>` header. Raw secrets are shown once at creation and stored hashed (SHA-256).",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string" },
            code: { type: "string", example: "INSUFFICIENT_SCOPE" },
          },
        },
        OrderInput: {
          type: "object",
          required: ["items"],
          properties: {
            idempotencyKey: { type: "string", description: "Optional idempotency token for safe retries" },
            customerId: { type: "string", format: "uuid" },
            shippingAddress: { type: "string" },
            notes: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["title", "quantity", "unitPrice"],
                properties: {
                  productId: { type: "string", format: "uuid" },
                  variantId: { type: "string", format: "uuid" },
                  title: { type: "string" },
                  quantity: { type: "integer", minimum: 1 },
                  unitPrice: { type: "number", minimum: 0 },
                },
              },
            },
          },
        },
        WebhookSubscriptionInput: {
          type: "object",
          required: ["targetUrl", "eventTypes"],
          properties: {
            targetUrl: { type: "string", format: "uri" },
            eventTypes: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "order.created",
                  "order.updated",
                  "payment.captured",
                  "payment.failed",
                  "shipment.created",
                  "shipment.delivered",
                  "return.requested",
                  "refund.completed",
                  "dispute.created",
                  "buyer.identity.updated",
                ],
              },
            },
          },
        },
      },
      headers: {
        RateLimitHeaders: {
          description: "Standard sliding-window rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`).",
        },
      },
    },
    "x-orderflow-conventions": {
      scopes: [
        "orders:read",
        "orders:write",
        "products:read",
        "products:write",
        "customers:read",
        "transactions:read",
        "payments:read",
        "shipments:read",
        "webhooks:manage",
        "analytics:read",
        "marketplace:read",
      ],
      webhookSignatureVerification: {
        header: "x-orderflow-signature",
        format: "t=<unix_seconds>,v1=<hmac_sha256_hex>",
        signedPayload: "${timestamp}.${rawBody}",
        replayWindowSeconds: 300,
      },
      pagination: {
        queryParams: ["page (default 1)", "limit (default 20, max 100)"],
        responseMeta: { total: "integer", page: "integer", limit: "integer", totalPages: "integer" },
      },
      idempotency: "Send `Idempotency-Key` header on mutating POST requests to prevent duplicate resource creation on network retries.",
      environments: {
        SANDBOX: "Sandbox keys (`of_test_*`) only access or create sandbox data (`isSandbox = true`) and never affect live financial ledgers.",
        LIVE: "Live keys (`of_live_*`) operate strictly on production tenant data (`isSandbox = false`).",
      },
    },
    paths: {
      "/orders": {
        get: {
          summary: "List tenant orders",
          "x-required-scope": "orders:read",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          ],
          responses: { "200": { description: "Paginated orders list" }, "401": { description: "Invalid API key" }, "403": { description: "Missing orders:read scope" } },
        },
        post: {
          summary: "Create order via API",
          "x-required-scope": "orders:write",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/OrderInput" } } } },
          responses: { "201": { description: "Order and canonical SocialTransaction created" } },
        },
      },
      "/orders/{id}": {
        get: { summary: "Get order details", "x-required-scope": "orders:read", responses: { "200": { description: "Order record" } } },
      },
      "/products": {
        get: { summary: "List tenant products", "x-required-scope": "products:read", responses: { "200": { description: "Paginated products list" } } },
        post: { summary: "Create tenant product", "x-required-scope": "products:write", responses: { "201": { description: "Product created" } } },
      },
      "/transactions": {
        get: { summary: "List social transactions", "x-required-scope": "transactions:read", responses: { "200": { description: "Paginated transactions" } } },
      },
      "/customers": {
        get: { summary: "List tenant customers", "x-required-scope": "customers:read", responses: { "200": { description: "Paginated customers" } } },
      },
      "/payments": {
        get: { summary: "List payment records", "x-required-scope": "payments:read", responses: { "200": { description: "Paginated payments" } } },
      },
      "/shipments": {
        get: { summary: "List shipments", "x-required-scope": "shipments:read", responses: { "200": { description: "Paginated shipments" } } },
      },
      "/webhooks": {
        get: { summary: "List webhook subscriptions", "x-required-scope": "webhooks:manage", responses: { "200": { description: "Webhook subscriptions" } } },
        post: { summary: "Register outbound webhook subscription", "x-required-scope": "webhooks:manage", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookSubscriptionInput" } } } }, responses: { "201": { description: "Subscription created with one-time signing secret" } } },
      },
      "/analytics": {
        get: { summary: "Retrieve tenant commerce analytics", "x-required-scope": "analytics:read", responses: { "200": { description: "Revenue & fulfillment metrics" } } },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
