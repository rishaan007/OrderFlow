// API Rate Limiting Utility
// Supports:
// 1. Synchronous per-instance sliding window (`rateLimiter` / `checkRateLimit`) — explicitly scoped to single-node memory.
// 2. Distributed PostgreSQL-backed atomic counter (`checkDistributedRateLimit`) — safe across multi-instance serverless deployments.

import { prisma } from "./prisma";

interface RateLimitRecord {
  count: number;
  resetAt: number; // epoch ms
}

class MemoryRateLimiter {
  private store: Map<string, RateLimitRecord> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically clean up expired entries to prevent memory leaks
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(() => {
        const now = Date.now();
        this.store.forEach((record, key) => {
          if (record.resetAt <= now) {
            this.store.delete(key);
          }
        });
      }, 60000);

      // Prevent the timer from keeping the process alive in tests
      if (this.cleanupInterval && typeof this.cleanupInterval.unref === "function") {
        this.cleanupInterval.unref();
      }
    }
  }

  /**
   * Check and increment rate limit for a given key
   * @param key Unique identifier (IP, userId, businessId, etc.)
   * @param limit Maximum allowed requests within window
   * @param windowMs Time window in milliseconds
   */
  check(
    key: string,
    limit: number,
    windowMs: number
  ): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    total: number;
  } {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt,
        total: 1,
      };
    }

    existing.count += 1;
    const remaining = Math.max(0, limit - existing.count);
    const allowed = existing.count <= limit;

    return {
      allowed,
      remaining,
      resetAt: existing.resetAt,
      total: existing.count,
    };
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const rateLimiter = new MemoryRateLimiter();

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  keyPrefix?: string;
  identifierOverride?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  backend: "MEMORY_SINGLE_NODE" | "POSTGRES_DISTRIBUTED";
  headers: Record<string, string>;
}

function extractClientIdentifier(req: Request, identifierOverride?: string): string {
  if (identifierOverride) return identifierOverride;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "127.0.0.1";
  const authHeader = req.headers.get("authorization");
  return authHeader ? `${authHeader.slice(-16)}` : ip;
}

function buildRateLimitHeaders(limit: number, remaining: number, resetAt: number, backend: string): Record<string, string> {
  const resetSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(resetSeconds),
    "X-RateLimit-Backend": backend,
  };
  if (remaining <= 0) {
    headers["Retry-After"] = String(resetSeconds);
  }
  return headers;
}

/**
 * Single-node in-memory rate limit check (fast path, never claimed as multi-region distributed).
 */
export function checkRateLimit(
  req: Request,
  options: RateLimitOptions = {}
): RateLimitResult {
  const limit = options.limit ?? 100;
  const windowMs = options.windowMs ?? 60 * 1000;
  const prefix = options.keyPrefix ?? "api";
  const identifier = extractClientIdentifier(req, options.identifierOverride);

  const key = `${prefix}:${identifier}`;
  const result = rateLimiter.check(key, limit, windowMs);

  return {
    ...result,
    limit,
    backend: "MEMORY_SINGLE_NODE",
    headers: buildRateLimitHeaders(limit, result.remaining, result.resetAt, "MEMORY_SINGLE_NODE"),
  };
}

/**
 * Shared PostgreSQL-backed rate limit counter safe across horizontal server instances.
 * Falls back to single-node memory only if the backing table is unavailable.
 */
export async function checkDistributedRateLimit(
  req: Request,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const limit = options.limit ?? 100;
  const windowMs = options.windowMs ?? 60 * 1000;
  const prefix = options.keyPrefix ?? "dist-api";
  const identifier = extractClientIdentifier(req, options.identifierOverride);
  const key = `${prefix}:${identifier}`;

  try {
    const now = new Date();
    const nextReset = new Date(now.getTime() + windowMs);

    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "network_rate_limits" ("key", "count", "resetAt", "updatedAt")
      VALUES (${key}, 1, ${nextReset}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "network_rate_limits"."resetAt" <= ${now} THEN 1
          ELSE "network_rate_limits"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "network_rate_limits"."resetAt" <= ${now} THEN ${nextReset}
          ELSE "network_rate_limits"."resetAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "resetAt"
    `;

    const row = rows[0];
    const count = row?.count ?? 1;
    const resetAtMs = row?.resetAt ? new Date(row.resetAt).getTime() : nextReset.getTime();
    const remaining = Math.max(0, limit - count);
    const allowed = count <= limit;

    return {
      allowed,
      remaining,
      resetAt: resetAtMs,
      limit,
      backend: "POSTGRES_DISTRIBUTED",
      headers: buildRateLimitHeaders(limit, remaining, resetAtMs, "POSTGRES_DISTRIBUTED"),
    };
  } catch {
    return checkRateLimit(req, options);
  }
}
