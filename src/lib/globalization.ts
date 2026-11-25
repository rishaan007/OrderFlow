import { minorUnitsToMajorString, normalizeCurrency, getCurrencyDecimals } from "./money";
import { resolveLocale, SupportedLocale } from "./i18n";
import { ValidationError } from "./errors";

/**
 * Validates an IANA timezone identifier without relying on server-local offsets.
 */
export function isValidTimezone(tz?: string | null): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(tz?: string | null): string {
  if (tz && isValidTimezone(tz)) {
    return tz.trim();
  }
  return "UTC";
}

/**
 * Deterministic timestamp formatting anchored in UTC storage and rendered
 * strictly in the requested IANA timezone and locale.
 */
export function formatTimestampInTimezone(
  timestamp: Date | string,
  options?: {
    timezone?: string | null;
    locale?: string | null;
    includeTime?: boolean;
  }
): {
  utcIso: string;
  timezone: string;
  locale: SupportedLocale;
  formatted: string;
} {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("Invalid timestamp");
  }
  const timezone = normalizeTimezone(options?.timezone);
  const locale = resolveLocale(options?.locale);
  const includeTime = options?.includeTime ?? true;

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    ...(includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }
      : {}),
  });

  return {
    utcIso: date.toISOString(),
    timezone,
    locale,
    formatted: formatter.format(date),
  };
}

export interface GlobalAddressInput {
  name: string;
  phone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  countryCode: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface NormalizedGlobalAddress {
  name: string;
  phone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  rawPreserved: {
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string | null;
    postalCode: string | null;
    countryCode: string;
  };
  formattedSingleLine: string;
}

export function normalizeCountryCode(countryCode?: string | null): string {
  const normalized = (countryCode || "US").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new ValidationError(`Invalid ISO-3166-1 alpha-2 country code: ${countryCode}`);
  }
  return normalized;
}

export function normalizeGlobalPhone(
  phone?: string | null,
  defaultDialCountryCode?: string | null
): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 6 || digits.length > 15) {
    return null;
  }
  if (hasPlus) return `+${digits}`;

  const dialMap: Record<string, string> = {
    US: "+1",
    CA: "+1",
    GB: "+44",
    IN: "+91",
    AE: "+971",
    SG: "+65",
    AU: "+61",
    DE: "+49",
    FR: "+33",
    JP: "+81",
  };
  const prefix = defaultDialCountryCode ? dialMap[defaultDialCountryCode.toUpperCase()] : undefined;
  return prefix ? `${prefix}${digits}` : digits;
}

/**
 * Normalizes global addresses while strictly preserving raw user input.
 * Coordinates are only stored when explicitly supplied and finite — never inferred.
 */
export function normalizeStructuredAddress(
  input: GlobalAddressInput
): NormalizedGlobalAddress {
  const countryCode = normalizeCountryCode(input.countryCode);
  const name = input.name.trim();
  const addressLine1 = input.addressLine1.trim();
  const addressLine2 = input.addressLine2 ? input.addressLine2.trim() || null : null;
  const city = input.city.trim();
  const state = input.state ? input.state.trim() || null : null;
  const postalCode = input.postalCode ? input.postalCode.trim().toUpperCase() || null : null;

  if (!name || !addressLine1 || !city) {
    throw new ValidationError("Address name, addressLine1, and city are required");
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (typeof input.latitude === "number" && Number.isFinite(input.latitude)) {
    if (input.latitude < -90 || input.latitude > 90) {
      throw new ValidationError("Latitude must be between -90 and 90");
    }
    latitude = input.latitude;
  }
  if (typeof input.longitude === "number" && Number.isFinite(input.longitude)) {
    if (input.longitude < -180 || input.longitude > 180) {
      throw new ValidationError("Longitude must be between -180 and 180");
    }
    longitude = input.longitude;
  }

  const formattedSingleLine = [
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    countryCode,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    name,
    phone: normalizeGlobalPhone(input.phone, countryCode),
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    countryCode,
    latitude,
    longitude,
    rawPreserved: {
      name: input.name,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 ?? null,
      city: input.city,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      countryCode: input.countryCode,
    },
    formattedSingleLine,
  };
}

/**
 * Formats integer minor units in a given currency and locale without float precision loss.
 */
export function formatMoneyLocalized(
  amountMinorUnits: number,
  currencyCode: string = "USD",
  locale?: string | null
): string {
  const currency = normalizeCurrency(currencyCode);
  const resolvedLocale = resolveLocale(locale);
  const decimals = getCurrencyDecimals(currency);
  const majorStr = minorUnitsToMajorString(amountMinorUnits, currency);

  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(majorStr));
  } catch {
    return `${currency} ${majorStr}`;
  }
}

export interface RegionalCapabilities {
  countryCode: string;
  defaultCurrency: string;
  defaultTimezone: string;
  recommendedPaymentProviders: string[];
  recommendedLogisticsProviders: string[];
}

export function getRegionalCapabilities(countryCode?: string | null): RegionalCapabilities {
  const code = normalizeCountryCode(countryCode || "US");
  const presets: Record<string, RegionalCapabilities> = {
    IN: {
      countryCode: "IN",
      defaultCurrency: "INR",
      defaultTimezone: "Asia/Kolkata",
      recommendedPaymentProviders: ["RAZORPAY", "STRIPE", "MANUAL"],
      recommendedLogisticsProviders: ["DELHIVERY", "SHIPROCKET", "BLUEDART", "PORTER", "MANUAL"],
    },
    US: {
      countryCode: "US",
      defaultCurrency: "USD",
      defaultTimezone: "America/New_York",
      recommendedPaymentProviders: ["STRIPE", "MANUAL"],
      recommendedLogisticsProviders: ["FEDEX", "LOCAL_COURIER", "MANUAL"],
    },
    GB: {
      countryCode: "GB",
      defaultCurrency: "GBP",
      defaultTimezone: "Europe/London",
      recommendedPaymentProviders: ["STRIPE", "MANUAL"],
      recommendedLogisticsProviders: ["FEDEX", "LOCAL_COURIER", "MANUAL"],
    },
    AE: {
      countryCode: "AE",
      defaultCurrency: "AED",
      defaultTimezone: "Asia/Dubai",
      recommendedPaymentProviders: ["STRIPE", "MANUAL"],
      recommendedLogisticsProviders: ["FEDEX", "LOCAL_COURIER", "MANUAL"],
    },
    SG: {
      countryCode: "SG",
      defaultCurrency: "SGD",
      defaultTimezone: "Asia/Singapore",
      recommendedPaymentProviders: ["STRIPE", "MANUAL"],
      recommendedLogisticsProviders: ["FEDEX", "LOCAL_COURIER", "MANUAL"],
    },
  };

  return (
    presets[code] ?? {
      countryCode: code,
      defaultCurrency: "USD",
      defaultTimezone: "UTC",
      recommendedPaymentProviders: ["STRIPE", "MANUAL", "OTHER"],
      recommendedLogisticsProviders: ["FEDEX", "LOCAL_COURIER", "MANUAL"],
    }
  );
}
