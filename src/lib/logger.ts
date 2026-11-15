// Structured Logger for OrderFlow SaaS
// Provides production JSON logging, contextual metadata, and sensitive data sanitization

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogContext {
  businessId?: string;
  userId?: string;
  requestId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  [key: string]: any;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "secret",
  "whatsappAccessToken",
  "instagramAccessToken",
  "jwtSecret",
  "apiKey",
  "authorization",
  "cookie",
]);

export function sanitizeLogData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase()) || key.toLowerCase().includes("secret") || key.toLowerCase().includes("token")) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

class StructuredLogger {
  private formatMessage(level: LogLevel, message: string, context?: LogContext, error?: Error | unknown): string {
    const timestamp = new Date().toISOString();
    const isProduction = process.env.NODE_ENV === "production";

    const logEntry = {
      timestamp,
      level,
      message,
      context: context ? sanitizeLogData(context) : undefined,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: isProduction ? undefined : error.stack,
      } : error,
    };

    if (isProduction) {
      return JSON.stringify(logEntry);
    }

    // Clean formatting for development
    const colors: Record<LogLevel, string> = {
      DEBUG: "\x1b[34m", // Blue
      INFO: "\x1b[32m",  // Green
      WARN: "\x1b[33m",  // Yellow
      ERROR: "\x1b[31m", // Red
    };
    const reset = "\x1b[0m";
    const ctxStr = context ? ` ${JSON.stringify(sanitizeLogData(context))}` : "";
    const errStr = error instanceof Error ? `\n${error.stack || error.message}` : "";
    return `[${timestamp}] ${colors[level]}[${level}]${reset} ${message}${ctxStr}${errStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== "production") {
      console.debug(this.formatMessage("DEBUG", message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    console.info(this.formatMessage("INFO", message, context));
  }

  warn(message: string, context?: LogContext, error?: Error | unknown): void {
    console.warn(this.formatMessage("WARN", message, context, error));
  }

  error(message: string, context?: LogContext, error?: Error | unknown): void {
    console.error(this.formatMessage("ERROR", message, context, error));
  }
}

export const logger = new StructuredLogger();
