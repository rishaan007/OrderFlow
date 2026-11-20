import { prisma } from "@/lib/prisma";
import { ConnectionStatus, ConnectionHealthStatus, SocialPlatform } from "@prisma/client";
import { checkConnectionHealth } from "./connections";
import { getSocialProvider } from "./providers/registry";

export interface ReconcileResult {
  total: number;
  healthy: number;
  degraded: number;
  authRequired: number;
  results: Record<string, string>;
}

/**
 * Reconciles and verifies the health status of all registered connections for a business
 */
export async function reconcileBusinessConnections(
  businessId: string
): Promise<ReconcileResult> {
  const connections = await prisma.socialConnection.findMany({
    where: {
      businessId,
      status: { not: ConnectionStatus.DISCONNECTED },
    },
  });

  const summary: ReconcileResult = {
    total: connections.length,
    healthy: 0,
    degraded: 0,
    authRequired: 0,
    results: {},
  };

  for (const conn of connections) {
    try {
      const health = await checkConnectionHealth(businessId, conn.id);
      summary.results[conn.platform] = health.status;

      if (health.status === ConnectionHealthStatus.HEALTHY) {
        summary.healthy++;
      } else if (health.status === ConnectionHealthStatus.AUTHENTICATION_REQUIRED) {
        summary.authRequired++;
      } else {
        summary.degraded++;
      }
    } catch (err: any) {
      summary.degraded++;
      summary.results[conn.platform] = `Error: ${err.message}`;
    }
  }

  return summary;
}

/**
 * Performs catalog synchronization for a specific platform connection
 */
export async function syncConnectionCatalog(
  businessId: string,
  connectionId: string
) {
  const connection = await prisma.socialConnection.findFirst({
    where: { id: connectionId, businessId },
  });

  if (!connection) {
    throw new Error("Connection not found");
  }

  const provider = getSocialProvider(connection.platform);
  const products = await prisma.product.findMany({
    where: { businessId, status: "ACTIVE" },
    take: 50,
  });

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const prod of products) {
    try {
      const res = await provider.syncProductCatalog(
        {
          id: prod.id,
          title: prod.title,
          price: Number(prod.price),
          description: prod.description,
          stockQuantity: prod.stockQuantity,
        },
        "UPSERT"
      );

      if (res.status === "SYNCED") {
        synced++;
      } else {
        failed++;
        if (res.error) errors.push(res.error);
      }
    } catch (err: any) {
      failed++;
      errors.push(err.message);
    }
  }

  await prisma.socialConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
    },
  });

  return {
    totalProducts: products.length,
    synced,
    failed,
    errors: Array.from(new Set(errors)),
  };
}
