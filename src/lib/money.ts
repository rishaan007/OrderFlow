import { Prisma } from "@prisma/client";
import { ValidationError } from "./errors";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

export interface MoneyValue {
  amountMinorUnits: number;
  currency: string;
}

/**
 * Returns ISO-4217 decimal exponent for a currency code.
 */
export function getCurrencyDecimals(currencyCode: string = "USD"): number {
  const code = (currencyCode || "USD").toUpperCase().trim();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/**
 * Validates that a currency code is a clean 3-letter ISO-4217 alphabetic code.
 */
export function normalizeCurrency(currencyCode?: string | null): string {
  const normalized = (currencyCode || "USD").toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ValidationError(`Invalid ISO-4217 currency code: ${currencyCode}`);
  }
  return normalized;
}

/**
 * Validates that minor units is a finite safe integer.
 */
export function assertValidMinorUnits(
  minorUnits: number,
  fieldName: string = "amountMinorUnits",
  allowNegative: boolean = false
): number {
  if (typeof minorUnits !== "number" || !Number.isInteger(minorUnits) || !Number.isSafeInteger(minorUnits)) {
    throw new ValidationError(`${fieldName} must be a finite integer in minor units`);
  }
  if (!allowNegative && minorUnits < 0) {
    throw new ValidationError(`${fieldName} cannot be negative`);
  }
  return minorUnits;
}

/**
 * Converts a major-unit string, number, or Prisma.Decimal into exact integer minor units
 * using string decimal parsing (zero IEEE-754 floating-point multiplication/rounding drift).
 */
export function toMinorUnits(
  amount: string | number | Prisma.Decimal,
  currencyCode: string = "USD"
): number {
  const currency = normalizeCurrency(currencyCode);
  const decimals = getCurrencyDecimals(currency);

  let raw: string;
  if (amount instanceof Prisma.Decimal) {
    raw = amount.toFixed(decimals);
  } else if (typeof amount === "number") {
    if (!Number.isFinite(amount)) {
      throw new ValidationError("Monetary amount must be a finite number");
    }
    raw = amount.toFixed(decimals);
  } else if (typeof amount === "string") {
    raw = amount.trim();
  } else {
    throw new ValidationError("Unsupported monetary value type");
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) {
    throw new ValidationError(`Invalid monetary string format: "${raw}"`);
  }

  const isNegative = raw.startsWith("-");
  const unsigned = raw.replace(/^[+-]/, "");
  const [wholePart, fracPart = ""] = unsigned.split(".");

  if (decimals === 0) {
    const truncatedFrac = fracPart.replace(/0+$/, "");
    if (truncatedFrac.length > 0) {
      throw new ValidationError(`Currency ${currency} does not support fractional minor units`);
    }
    const wholeInt = parseInt(wholePart, 10);
    const result = isNegative ? -wholeInt : wholeInt;
    return result === 0 ? 0 : result;
  }

  const normalizedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const extraDigits = fracPart.slice(decimals).replace(/0+$/, "");
  if (extraDigits.length > 0 && typeof amount === "string") {
    throw new ValidationError(
      `Monetary value "${raw}" has more than ${decimals} decimal places for ${currency}`
    );
  }

  const scale = 10 ** decimals;
  const wholeInt = parseInt(wholePart, 10) * scale;
  const fracInt = parseInt(normalizedFrac || "0", 10);
  const absMinor = wholeInt + fracInt;
  const result = isNegative ? -absMinor : absMinor;
  return result === 0 ? 0 : result;
}

/**
 * Converts integer minor units into a major-unit exact decimal string without floating-point math.
 */
export function minorUnitsToMajorString(
  minorUnits: number,
  currencyCode: string = "USD"
): string {
  assertValidMinorUnits(minorUnits, "minorUnits", true);
  const currency = normalizeCurrency(currencyCode);
  const decimals = getCurrencyDecimals(currency);

  if (decimals === 0) {
    return String(minorUnits);
  }

  const sign = minorUnits < 0 ? "-" : "";
  const abs = Math.abs(minorUnits);
  const scale = 10 ** decimals;
  const whole = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(decimals, "0");
  return `${sign}${whole}.${frac}`;
}

/**
 * Converts integer minor units into an exact Prisma.Decimal without float drift.
 */
export function minorUnitsToDecimal(
  minorUnits: number,
  currencyCode: string = "USD"
): Prisma.Decimal {
  return new Prisma.Decimal(minorUnitsToMajorString(minorUnits, currencyCode));
}

/**
 * Converts integer minor units into a formatted currency display string.
 */
export function formatMinorUnits(
  minorUnits: number,
  currencyCode: string = "USD"
): string {
  const currency = normalizeCurrency(currencyCode);
  const decimals = getCurrencyDecimals(currency);
  const majorString = minorUnitsToMajorString(minorUnits, currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(Number(majorString));
  } catch {
    return `${currency} ${majorString}`;
  }
}

/**
 * Integer-only addition with overflow guard.
 */
export function addMinorUnits(a: number, b: number): number {
  assertValidMinorUnits(a, "a", true);
  assertValidMinorUnits(b, "b", true);
  const sum = a + b;
  assertValidMinorUnits(sum, "sum", true);
  return sum;
}

/**
 * Integer-only subtraction with overflow guard.
 */
export function subtractMinorUnits(a: number, b: number): number {
  assertValidMinorUnits(a, "a", true);
  assertValidMinorUnits(b, "b", true);
  const diff = a - b;
  assertValidMinorUnits(diff, "diff", true);
  return diff;
}

/**
 * Computes percentage of minor units using integer BigInt arithmetic (round-half-up).
 */
export function calculatePercentageMinorUnits(
  amountMinorUnits: number,
  percentage: number
): number {
  assertValidMinorUnits(amountMinorUnits, "amountMinorUnits");
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new ValidationError("Percentage must be between 0 and 100");
  }
  const basisPoints = BigInt(Math.round(percentage * 100));
  const scaled = BigInt(amountMinorUnits) * basisPoints + BigInt(5000);
  return Number(scaled / BigInt(10000));
}

/**
 * Computes canonical order totals purely in integer minor units.
 */
export function calculateOrderTotalsMinorUnits(params: {
  items: Array<{ quantity: number; unitPrice: string | number | Prisma.Decimal }>;
  discount?: string | number | Prisma.Decimal;
  discountType?: string;
  shipping?: string | number | Prisma.Decimal;
  tax?: string | number | Prisma.Decimal;
  currency: string;
}) {
  const currency = normalizeCurrency(params.currency);

  const itemCalculations = params.items.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new ValidationError("Item quantity must be an integer >= 1");
    }
    const unitMinor = toMinorUnits(item.unitPrice, currency);
    if (unitMinor < 0) {
      throw new ValidationError("Unit price cannot be negative");
    }
    const totalMinor = unitMinor * item.quantity;
    return {
      unitPriceMinorUnits: unitMinor,
      totalPriceMinorUnits: totalMinor,
      unitPriceDecimal: minorUnitsToDecimal(unitMinor, currency),
      totalPriceDecimal: minorUnitsToDecimal(totalMinor, currency),
    };
  });

  const subtotalMinorUnits = itemCalculations.reduce(
    (acc, item) => addMinorUnits(acc, item.totalPriceMinorUnits),
    0
  );

  let discountMinorUnits = 0;
  if (params.discount !== undefined && params.discount !== null) {
    const rawDiscount = Number(params.discount);
    if (rawDiscount > 0) {
      if (params.discountType === "PERCENTAGE") {
        discountMinorUnits = calculatePercentageMinorUnits(subtotalMinorUnits, Math.min(100, rawDiscount));
      } else {
        discountMinorUnits = Math.min(
          subtotalMinorUnits,
          toMinorUnits(params.discount, currency)
        );
      }
    }
  }

  const shippingMinorUnits =
    params.shipping !== undefined && params.shipping !== null
      ? Math.max(0, toMinorUnits(params.shipping, currency))
      : 0;
  const taxMinorUnits =
    params.tax !== undefined && params.tax !== null
      ? Math.max(0, toMinorUnits(params.tax, currency))
      : 0;

  const totalMinorUnits =
    subtotalMinorUnits - discountMinorUnits + shippingMinorUnits + taxMinorUnits;

  return {
    currency,
    items: itemCalculations,
    subtotalMinorUnits,
    discountMinorUnits,
    shippingMinorUnits,
    taxMinorUnits,
    totalMinorUnits,
    subtotalDecimal: minorUnitsToDecimal(subtotalMinorUnits, currency),
    discountDecimal: minorUnitsToDecimal(discountMinorUnits, currency),
    shippingDecimal: minorUnitsToDecimal(shippingMinorUnits, currency),
    taxDecimal: minorUnitsToDecimal(taxMinorUnits, currency),
    totalDecimal: minorUnitsToDecimal(totalMinorUnits, currency),
  };
}
