// Application Errors & API Error Handler
import { NextResponse } from "next/server";
import { logger } from "./logger";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, statusCode: number = 400, code: string = "BAD_REQUEST", details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "You do not have permission to perform this action") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resource conflict") {
    super(message, 409, "CONFLICT");
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfterSeconds: number;

  constructor(message: string = "Rate limit exceeded. Please try again later.", retryAfterSeconds: number = 60) {
    super(message, 429, "RATE_LIMIT_EXCEEDED", { retryAfter: retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PlanLimitExceededError extends AppError {
  public readonly currentUsage: number;
  public readonly limit: number;
  public readonly resource: string;

  constructor(resource: string, currentUsage: number, limit: number) {
    super(
      `Monthly ${resource} limit (${limit}) reached for your subscription plan. Upgrade your plan to increase limits.`,
      403,
      "PLAN_LIMIT_EXCEEDED",
      { resource, currentUsage, limit }
    );
    this.resource = resource;
    this.currentUsage = currentUsage;
    this.limit = limit;
  }
}

export function handleApiError(error: unknown, context?: { action?: string; businessId?: string; userId?: string }): NextResponse {
  if (error instanceof AppError) {
    logger.warn(`API Error [${error.code}]: ${error.message}`, {
      ...context,
      statusCode: error.statusCode,
      code: error.code,
    });

    const headers: Record<string, string> = {};
    if (error instanceof RateLimitError) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: error.statusCode, headers }
    );
  }

  // Unhandled error
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error(`Unhandled API Exception: ${err.message}`, context, err);

  const isProduction = process.env.NODE_ENV === "production";
  return NextResponse.json(
    {
      success: false,
      error: isProduction ? "An unexpected internal server error occurred" : err.message,
      code: "INTERNAL_SERVER_ERROR",
    },
    { status: 500 }
  );
}
