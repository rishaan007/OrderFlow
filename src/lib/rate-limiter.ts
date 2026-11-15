// API Rate Limiting Utility
// Implements in-memory sliding window algorithm with automatic cleanup

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
      // First request or window expired
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return {
        allowed: true,
        remaining: limit - 1,
        resetAt,
        total: 1,
      };
    }

    // Existing window
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
}

/**
 * Apply rate limiting to an incoming Next.js Request
 */
export function checkRateLimit(
  req: Request,
  options: RateLimitOptions = {}
): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  headers: Record<string, string>;
} {
  const limit = options.limit ?? 100; // default 100 req per minute
  const windowMs = options.windowMs ?? 60 * 1000;
  const prefix = options.keyPrefix ?? "api";

  // Extract IP or client identifier
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "127.0.0.1";
  const authHeader = req.headers.get("authorization");
  const identifier = authHeader ? `${authHeader.slice(-16)}` : ip;

  const key = `${prefix}:${identifier}`;
  const result = rateLimiter.check(key, limit, windowMs);

  const resetSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(resetSeconds),
  };

  if (!result.allowed) {
    headers["Retry-After"] = String(resetSeconds);
  }

  return {
    ...result,
    limit,
    headers,
  };
}
