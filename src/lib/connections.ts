import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  SocialPlatform,
  ConnectionStatus,
  ConnectionHealthStatus,
  Prisma,
} from "@prisma/client";
import { getSocialProvider } from "@/lib/providers/registry";
import { ConnectionHealthCheckResult } from "@/lib/providers/types";

// Encryption configuration for tokens (AES-256-GCM)
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_SECRET ||
    process.env.JWT_SECRET ||
    "orderflow_master_encryption_key_32_bytes_min";
  // Derive a 32-byte key using SHA-256
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a plaintext token string with AES-256-GCM
 */
export function encryptToken(plainText: string): string {
  if (!plainText) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Return format: iv:tag:ciphertext (base64 encoded)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypts an AES-256-GCM encrypted token string
 */
export function decryptToken(encryptedString: string): string {
  if (!encryptedString) return "";
  try {
    const parts = encryptedString.split(":");
    if (parts.length !== 3) return "";

    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");

    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Token decryption failed:", error);
    return "";
  }
}

/**
 * Sanitizes a SocialConnection entity so tokens and internal secrets are NEVER sent to the client
 */
export function sanitizeConnection(connection: any) {
  if (!connection) return null;
  const {
    encryptedAccessToken,
    encryptedRefreshToken,
    webhookSecret,
    ...safeConnection
  } = connection;

  return {
    ...safeConnection,
    hasAccessToken: !!encryptedAccessToken,
    hasRefreshToken: !!encryptedRefreshToken,
    hasWebhookSecret: !!webhookSecret,
  };
}

export interface ConnectPlatformInput {
  platform: SocialPlatform;
  accountIdentifier: string;
  accountName?: string;
  avatarUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  webhookSecret?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Creates or updates a platform connection for a tenant
 */
export async function createOrUpdateConnection(
  businessId: string,
  input: ConnectPlatformInput
) {
  const provider = getSocialProvider(input.platform);
  const capabilities = provider.getDetailedCapabilities();

  const encryptedAccessToken = input.accessToken
    ? encryptToken(input.accessToken)
    : undefined;
  const encryptedRefreshToken = input.refreshToken
    ? encryptToken(input.refreshToken)
    : undefined;

  const connection = await prisma.socialConnection.upsert({
    where: {
      businessId_platform_accountIdentifier: {
        businessId,
        platform: input.platform,
        accountIdentifier: input.accountIdentifier,
      },
    },
    update: {
      accountName: input.accountName,
      avatarUrl: input.avatarUrl,
      status: ConnectionStatus.CONNECTED,
      healthStatus: ConnectionHealthStatus.HEALTHY,
      ...(encryptedAccessToken ? { encryptedAccessToken } : {}),
      ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
      ...(input.tokenExpiresAt ? { tokenExpiresAt: input.tokenExpiresAt } : {}),
      ...(input.webhookSecret ? { webhookSecret: input.webhookSecret } : {}),
      capabilities: capabilities as unknown as Prisma.InputJsonValue,
      metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      lastSyncAt: new Date(),
      lastError: null,
      connectedAt: new Date(),
    },
    create: {
      businessId,
      platform: input.platform,
      accountIdentifier: input.accountIdentifier,
      accountName: input.accountName || input.accountIdentifier,
      avatarUrl: input.avatarUrl,
      status: ConnectionStatus.CONNECTED,
      healthStatus: ConnectionHealthStatus.HEALTHY,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt: input.tokenExpiresAt,
      webhookSecret: input.webhookSecret,
      webhookVerified: true,
      capabilities: capabilities as unknown as Prisma.InputJsonValue,
      metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      lastSyncAt: new Date(),
      connectedAt: new Date(),
    },
  });

  return sanitizeConnection(connection);
}

/**
 * Gets all social connections for a business
 */
export async function getBusinessConnections(businessId: string) {
  const connections = await prisma.socialConnection.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
  });

  return connections.map(sanitizeConnection);
}

/**
 * Gets a specific connection by ID with tenant isolation verification
 */
export async function getConnectionById(businessId: string, connectionId: string) {
  const connection = await prisma.socialConnection.findFirst({
    where: {
      id: connectionId,
      businessId,
    },
  });

  return sanitizeConnection(connection);
}

/**
 * Disconnects a social connection
 */
export async function disconnectConnection(
  businessId: string,
  connectionId: string
) {
  const existing = await prisma.socialConnection.findFirst({
    where: { id: connectionId, businessId },
  });

  if (!existing) {
    throw new Error("Connection not found or tenant unauthorized");
  }

  // Attempt provider-level token revocation if access token exists
  if (existing.encryptedAccessToken) {
    const rawToken = decryptToken(existing.encryptedAccessToken);
    const provider = getSocialProvider(existing.platform);
    if (provider.disconnect) {
      await provider.disconnect(rawToken).catch(() => {});
    }
  }

  const updated = await prisma.socialConnection.update({
    where: { id: connectionId },
    data: {
      status: ConnectionStatus.DISCONNECTED,
      healthStatus: ConnectionHealthStatus.DISCONNECTED,
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      lastError: "Disconnected by user",
    },
  });

  return sanitizeConnection(updated);
}

/**
 * Actively checks the health of a connection via its provider
 */
export async function checkConnectionHealth(
  businessId: string,
  connectionId: string
): Promise<ConnectionHealthCheckResult> {
  const connection = await prisma.socialConnection.findFirst({
    where: { id: connectionId, businessId },
  });

  if (!connection) {
    return {
      status: ConnectionHealthStatus.DISCONNECTED,
      lastVerifiedAt: new Date(),
      errorMessage: "Connection not found",
      reconnectRequired: true,
    };
  }

  const rawAccessToken = connection.encryptedAccessToken
    ? decryptToken(connection.encryptedAccessToken)
    : undefined;

  const provider = getSocialProvider(connection.platform);
  let result: ConnectionHealthCheckResult;

  if (provider.checkHealth) {
    result = await provider.checkHealth({
      accessToken: rawAccessToken,
      accountId: connection.accountIdentifier,
    });
  } else {
    result = {
      status: ConnectionHealthStatus.HEALTHY,
      lastVerifiedAt: new Date(),
    };
  }

  // Update connection health status in DB
  await prisma.socialConnection.update({
    where: { id: connectionId },
    data: {
      healthStatus: result.status,
      lastSyncAt: new Date(),
      lastError: result.errorMessage || null,
      ...(result.reconnectRequired
        ? { status: ConnectionStatus.REAUTH_REQUIRED }
        : {}),
    },
  });

  return result;
}

/**
 * Resolves the decrypted credentials for internal outbound dispatch
 */
export async function getDecryptedConnectionCredentials(
  businessId: string,
  platform: SocialPlatform,
  accountIdentifier?: string
) {
  const connection = await prisma.socialConnection.findFirst({
    where: {
      businessId,
      platform,
      status: ConnectionStatus.CONNECTED,
      ...(accountIdentifier ? { accountIdentifier } : {}),
    },
  });

  if (!connection) return null;

  return {
    connectionId: connection.id,
    accountIdentifier: connection.accountIdentifier,
    accountName: connection.accountName,
    accessToken: connection.encryptedAccessToken
      ? decryptToken(connection.encryptedAccessToken)
      : undefined,
    refreshToken: connection.encryptedRefreshToken
      ? decryptToken(connection.encryptedRefreshToken)
      : undefined,
  };
}
