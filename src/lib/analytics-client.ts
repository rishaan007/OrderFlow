/**
 * Client-Side Analytics & Conversion Tracking Module
 *
 * Implements privacy-preserving, consent-gated event tracking.
 *
 * Requirements & Privacy Protections:
 * 1. Strictly respects user cookie consent (Performance & Analytics category).
 * 2. Does NOT dispatch telemetry unless the user has opted in via the Cookie Consent banner.
 * 3. Never transmits passwords, session tokens, secret keys, or sensitive customer PII.
 * 4. Integrates with Google Analytics 4 (GA4) / GTM when NEXT_PUBLIC_GA_MEASUREMENT_ID is supplied.
 * 5. Provides safe offline fallback & development console logging without breaking application flow.
 */

import { getStoredCookieConsent } from "@/components/common/CookieConsent";

export type ConversionType =
  | "REGISTER_SUCCESS"
  | "LOGIN_SUCCESS"
  | "ORDER_CREATED"
  | "WORKSPACE_ONBOARDED"
  | "INVITATION_ACCEPTED"
  | "CSV_EXPORTED";

interface EventPayload {
  [key: string]: string | number | boolean | null | undefined;
}

// Fields to scrub from all payloads before any dispatch
const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "token",
  "secret",
  "jwt",
  "bankDetails",
  "cardNumber",
  "cvv",
  "auth",
  "apiKey",
];

function isAnalyticsAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const consent = getStoredCookieConsent();
  return Boolean(consent?.analytics);
}

function sanitizePayload(data?: EventPayload): EventPayload {
  if (!data) return {};
  const clean: EventPayload = {};
  for (const [key, value] of Object.entries(data)) {
    const isSensitive = SENSITIVE_KEYS.some((s) =>
      key.toLowerCase().includes(s.toLowerCase())
    );
    if (!isSensitive) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Tracks a user event if analytics consent is granted.
 */
export function trackEvent(eventName: string, params?: EventPayload): void {
  if (!isAnalyticsAllowed()) {
    return;
  }

  const cleanParams = sanitizePayload(params);

  // If Google Analytics (gtag.js) is configured via NEXT_PUBLIC_GA_MEASUREMENT_ID
  if (typeof window !== "undefined" && (window as any).gtag) {
    (window as any).gtag("event", eventName, cleanParams);
  }

  // Developer logging in non-production
  if (process.env.NODE_ENV !== "production") {
    // Note: Log scrubbed payload for debugging verification
    console.debug(`[Analytics Event] ${eventName}:`, cleanParams);
  }
}

/**
 * Tracks a critical commercial or onboarding conversion action.
 */
export function trackConversion(type: ConversionType, details?: EventPayload): void {
  trackEvent(`conversion_${type.toLowerCase()}`, {
    conversion_type: type,
    timestamp: new Date().toISOString(),
    ...details,
  });
}

/**
 * Deduplicated page-view tracking
 */
let lastTrackedPath: string | null = null;

export function trackPageView(pathname: string): void {
  if (!isAnalyticsAllowed() || lastTrackedPath === pathname) {
    return;
  }
  lastTrackedPath = pathname;
  trackEvent("page_view", {
    page_path: pathname,
    page_title: typeof document !== "undefined" ? document.title : "",
  });
}
