import { ApiEnvironment, ConnectionStatus, IntegrationCategory, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { encryptToken } from "./connections";
import { NotFoundError } from "./errors";

const BUILT_IN_PROVIDERS: Array<{
  slug: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  capabilities: string[];
  authType: string;
}> = [
  {
    slug: "razorpay-payments",
    name: "Razorpay",
    category: IntegrationCategory.PAYMENTS,
    description: "Unified payment intents, UPI/card capture, refunds, and settlement webhooks.",
    capabilities: ["payments.create", "payments.capture", "payments.refund", "webhooks.verify"],
    authType: "API_KEY",
  },
  {
    slug: "stripe-payments",
    name: "Stripe",
    category: IntegrationCategory.PAYMENTS,
    description: "Global multi-currency payment intents, partial captures, and payouts.",
    capabilities: ["payments.create", "payments.capture", "payments.refund", "webhooks.verify"],
    authType: "API_KEY",
  },
  {
    slug: "delhivery-logistics",
    name: "Delhivery",
    category: IntegrationCategory.LOGISTICS,
    description: "Waybill generation, carrier pickups, and real-time tracking scan webhooks.",
    capabilities: ["shipments.label", "shipments.track", "returns.reverse_pickup"],
    authType: "API_KEY",
  },
  {
    slug: "shiprocket-logistics",
    name: "Shiprocket",
    category: IntegrationCategory.LOGISTICS,
    description: "Multi-carrier courier aggregator for domestic and cross-border shipping.",
    capabilities: ["shipments.rates", "shipments.label", "shipments.track"],
    authType: "API_KEY",
  },
  {
    slug: "zoho-books-accounting",
    name: "Zoho Books",
    category: IntegrationCategory.ACCOUNTING,
    description: "Sync OrderFlow double-entry ledger summaries, tax snapshots, and refunds.",
    capabilities: ["ledger.export", "tax.sync", "invoices.create"],
    authType: "OAUTH2",
  },
  {
    slug: "hubspot-crm",
    name: "HubSpot CRM",
    category: IntegrationCategory.CRM,
    description: "Synchronize tenant-scoped customer records and post-purchase milestones.",
    capabilities: ["customers.sync", "timeline.notify"],
    authType: "OAUTH2",
  },
  {
    slug: "ga4-analytics",
    name: "Google Analytics 4",
    category: IntegrationCategory.ANALYTICS,
    description: "Privacy-gated e-commerce funnel telemetry and attribution reporting.",
    capabilities: ["events.conversion", "funnel.track"],
    authType: "API_KEY",
  },
  {
    slug: "klaviyo-marketing",
    name: "Klaviyo",
    category: IntegrationCategory.MARKETING,
    description: "Post-delivery updates and buyer opted-in lifecycle campaigns.",
    capabilities: ["campaigns.trigger", "consent.sync"],
    authType: "API_KEY",
  },
  {
    slug: "whatsapp-cloud-comm",
    name: "WhatsApp Cloud API",
    category: IntegrationCategory.COMMUNICATION,
    description: "Verified customer DMs, transaction receipts, and shipping updates.",
    capabilities: ["messages.send", "messages.receive", "webhooks.verify"],
    authType: "OAUTH2",
  },
  {
    slug: "shopify-commerce-bridge",
    name: "Shopify Bridge",
    category: IntegrationCategory.COMMERCE,
    description: "Sync catalog inventory and channel orders into OrderFlow system-of-record.",
    capabilities: ["products.sync", "inventory.sync", "orders.import"],
    authType: "OAUTH2",
  },
];

export async function ensureBuiltInIntegrationProviders() {
  for (const p of BUILT_IN_PROVIDERS) {
    await prisma.integrationProvider.upsert({
      where: { slug: p.slug },
      create: p,
      update: {
        name: p.name,
        category: p.category,
        description: p.description,
        capabilities: p.capabilities,
        authType: p.authType,
      },
    });
  }
}

export async function listIntegrationCatalog(
  businessId: string,
  category?: IntegrationCategory
) {
  await ensureBuiltInIntegrationProviders();

  const [providers, connections] = await Promise.all([
    prisma.integrationProvider.findMany({
      where: {
        isActive: true,
        ...(category ? { category } : {}),
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.integrationConnection.findMany({
      where: { businessId },
      include: { provider: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const sanitizedConnections = connections.map((c) => ({
    id: c.id,
    businessId: c.businessId,
    providerId: c.providerId,
    providerSlug: c.provider.slug,
    providerName: c.provider.name,
    category: c.provider.category,
    status: c.status,
    environment: c.environment,
    externalAccountId: c.externalAccountId,
    hasCredentials: Boolean(c.encryptedCredentials),
    capabilities: c.capabilities,
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    lastError: c.lastError,
    createdAt: c.createdAt.toISOString(),
  }));

  return { providers, connections: sanitizedConnections };
}

export async function connectThirdPartyIntegration(
  businessId: string,
  input: {
    providerSlug: string;
    environment?: ApiEnvironment;
    externalAccountId?: string | null;
    credentials?: Record<string, string>;
    config?: Record<string, unknown>;
  }
) {
  await ensureBuiltInIntegrationProviders();

  const provider = await prisma.integrationProvider.findUnique({
    where: { slug: input.providerSlug },
  });
  if (!provider || !provider.isActive) {
    throw new NotFoundError(`Integration provider "${input.providerSlug}" not found`);
  }

  const env = input.environment ?? ApiEnvironment.SANDBOX;
  const encryptedCredentials =
    input.credentials && Object.keys(input.credentials).length > 0
      ? encryptToken(JSON.stringify(input.credentials))
      : null;

  const conn = await prisma.integrationConnection.upsert({
    where: {
      businessId_providerId_environment: {
        businessId,
        providerId: provider.id,
        environment: env,
      },
    },
    create: {
      businessId,
      providerId: provider.id,
      environment: env,
      status: ConnectionStatus.CONNECTED,
      externalAccountId: input.externalAccountId ?? null,
      encryptedCredentials,
      config: (input.config ?? {}) as Prisma.InputJsonValue,
      capabilities: provider.capabilities,
      lastSyncAt: new Date(),
    },
    update: {
      status: ConnectionStatus.CONNECTED,
      externalAccountId: input.externalAccountId ?? undefined,
      ...(encryptedCredentials ? { encryptedCredentials } : {}),
      ...(input.config ? { config: input.config as Prisma.InputJsonValue } : {}),
      capabilities: provider.capabilities,
      lastSyncAt: new Date(),
      lastError: null,
    },
    include: { provider: true },
  });

  await prisma.integrationEvent.create({
    data: {
      connectionId: conn.id,
      businessId,
      eventType: "INTEGRATION_CONNECTED",
      direction: "INBOUND",
      status: "PROCESSED",
      payload: {
        providerSlug: provider.slug,
        environment: env,
        capabilities: conn.capabilities,
      },
    },
  });

  return {
    id: conn.id,
    businessId: conn.businessId,
    providerSlug: conn.provider.slug,
    category: conn.provider.category,
    environment: conn.environment,
    status: conn.status,
    capabilities: conn.capabilities,
    hasCredentials: Boolean(conn.encryptedCredentials),
  };
}

export async function disconnectThirdPartyIntegration(
  businessId: string,
  connectionId: string
) {
  const existing = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, businessId },
    include: { provider: true },
  });
  if (!existing) throw new NotFoundError("Integration connection not found in business");

  const updated = await prisma.integrationConnection.update({
    where: { id: existing.id },
    data: {
      status: ConnectionStatus.DISCONNECTED,
      encryptedCredentials: null,
      lastError: "Disconnected by merchant",
    },
  });

  await prisma.integrationEvent.create({
    data: {
      connectionId: updated.id,
      businessId,
      eventType: "INTEGRATION_DISCONNECTED",
      direction: "OUTBOUND",
      status: "PROCESSED",
      payload: { providerSlug: existing.provider.slug },
    },
  });

  return {
    id: updated.id,
    status: updated.status,
    hasCredentials: false,
  };
}

export async function discoverIntegrationCapabilities(
  businessId: string,
  connectionId: string
) {
  const conn = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, businessId },
    include: { provider: true },
  });
  if (!conn) throw new NotFoundError("Integration connection not found");

  return {
    connectionId: conn.id,
    providerSlug: conn.provider.slug,
    category: conn.provider.category,
    status: conn.status,
    capabilities: conn.capabilities,
    authType: conn.provider.authType,
  };
}
