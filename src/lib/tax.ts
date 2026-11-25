import { Prisma, TaxCalculationMode } from "@prisma/client";
import { prisma } from "./prisma";
import {
  assertValidMinorUnits,
  addMinorUnits,
  subtractMinorUnits,
  normalizeCurrency,
  minorUnitsToDecimal,
} from "./money";
import { ValidationError } from "./errors";
import { normalizeCountryCode } from "./globalization";

export interface TaxCalculationInput {
  subtotalMinorUnits: number;
  discountMinorUnits?: number;
  shippingMinorUnits?: number;
  feesMinorUnits?: number;
  currency: string;
  countryCode?: string | null;
  stateCode?: string | null;
  category?: string | null;
  businessId?: string | null;
  explicitTaxMinorUnits?: number;
}

export interface TaxComponentBreakdown {
  name: string;
  rateBasisPoints: number;
  amountMinorUnits: number;
}

export interface OrderTotalSnapshot {
  version: string;
  calculatedAtUtc: string;
  currency: string;
  countryCode: string | null;
  stateCode: string | null;
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  taxableBaseMinorUnits: number;
  shippingMinorUnits: number;
  feesMinorUnits: number;
  taxMinorUnits: number;
  grandTotalMinorUnits: number;
  taxRuleId: string | null;
  taxRuleName: string | null;
  taxMode: TaxCalculationMode;
  components: TaxComponentBreakdown[];
}

/**
 * Computes exact minor-unit tax using basis points (e.g. 1800 = 18.00%).
 * Uses BigInt arithmetic with round-half-up to avoid floating-point drift.
 */
export function computeBasisPointsAmount(amountMinorUnits: number, basisPoints: number): number {
  assertValidMinorUnits(amountMinorUnits, "amountMinorUnits");
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    throw new ValidationError("rateBasisPoints must be an integer between 0 and 10000");
  }
  if (basisPoints === 0 || amountMinorUnits === 0) return 0;
  const result = (BigInt(amountMinorUnits) * BigInt(basisPoints) + BigInt(5000)) / BigInt(10000);
  return Number(result);
}

/**
 * Computes tax from inclusive pricing (extracts tax embedded in gross taxable base).
 */
export function computeInclusiveBasisPointsTax(grossMinorUnits: number, basisPoints: number): number {
  assertValidMinorUnits(grossMinorUnits, "grossMinorUnits");
  if (basisPoints <= 0 || grossMinorUnits === 0) return 0;
  const numerator = BigInt(grossMinorUnits) * BigInt(basisPoints);
  const denominator = BigInt(10000 + basisPoints);
  const half = denominator / BigInt(2);
  return Number((numerator + half) / denominator);
}

export async function createTaxRule(
  businessId: string | null,
  input: {
    name: string;
    countryCode: string;
    stateCode?: string | null;
    category?: string | null;
    rateBasisPoints: number;
    mode?: TaxCalculationMode;
    components?: Array<{ name: string; rateBasisPoints: number }>;
  }
) {
  const countryCode = normalizeCountryCode(input.countryCode);
  const components = input.components ?? [];
  if (components.length > 0) {
    const componentSum = components.reduce((s, c) => s + c.rateBasisPoints, 0);
    if (componentSum !== input.rateBasisPoints) {
      throw new ValidationError(
        `Sum of tax component rates (${componentSum} bps) must equal rule rateBasisPoints (${input.rateBasisPoints} bps)`
      );
    }
  }

  return prisma.taxRule.create({
    data: {
      businessId,
      name: input.name.trim(),
      countryCode,
      stateCode: input.stateCode ? input.stateCode.trim().toUpperCase() : null,
      category: input.category ? input.category.trim() : null,
      rateBasisPoints: input.rateBasisPoints,
      mode: input.mode ?? TaxCalculationMode.EXCLUSIVE,
      components: {
        create: components.map((c) => ({
          name: c.name.trim(),
          rateBasisPoints: c.rateBasisPoints,
        })),
      },
    },
    include: { components: true },
  });
}

export async function listTaxRules(businessId: string) {
  return prisma.taxRule.findMany({
    where: {
      isActive: true,
      OR: [{ businessId }, { businessId: null }],
    },
    include: { components: true },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
}

export async function resolveApplicableTaxRule(params: {
  businessId?: string | null;
  countryCode?: string | null;
  stateCode?: string | null;
  category?: string | null;
}) {
  if (!params.countryCode) return null;
  const countryCode = normalizeCountryCode(params.countryCode);
  const stateCode = params.stateCode ? params.stateCode.trim().toUpperCase() : null;

  const candidates = await prisma.taxRule.findMany({
    where: {
      isActive: true,
      countryCode,
      OR: [
        ...(params.businessId ? [{ businessId: params.businessId }] : []),
        { businessId: null },
      ],
    },
    include: { components: true },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  if (candidates.length === 0) return null;

  // Deterministic specificity ranking: tenant rule > global, state match > country match, category match > generic
  const scored = candidates.map((rule) => {
    let specificity = 0;
    if (rule.businessId && rule.businessId === params.businessId) specificity += 100;
    if (stateCode && rule.stateCode === stateCode) specificity += 20;
    else if (rule.stateCode && rule.stateCode !== stateCode) specificity -= 1000;
    if (params.category && rule.category === params.category) specificity += 10;
    else if (rule.category && rule.category !== params.category) specificity -= 1000;
    return { rule, specificity };
  });

  const valid = scored.filter((s) => s.specificity >= 0).sort((a, b) => b.specificity - a.specificity);
  return valid[0]?.rule ?? null;
}

/**
 * Produces an immutable OrderTotalSnapshot with exact integer minor units.
 * Historical orders store this snapshot so future tax/price changes never alter past orders.
 */
export async function calculateOrderTotalSnapshot(
  input: TaxCalculationInput
): Promise<OrderTotalSnapshot> {
  const currency = normalizeCurrency(input.currency);
  const subtotalMinorUnits = assertValidMinorUnits(input.subtotalMinorUnits, "subtotalMinorUnits");
  const discountMinorUnits = Math.min(
    subtotalMinorUnits,
    assertValidMinorUnits(input.discountMinorUnits ?? 0, "discountMinorUnits")
  );
  const shippingMinorUnits = assertValidMinorUnits(input.shippingMinorUnits ?? 0, "shippingMinorUnits");
  const feesMinorUnits = assertValidMinorUnits(input.feesMinorUnits ?? 0, "feesMinorUnits");
  const taxableBaseMinorUnits = subtractMinorUnits(subtotalMinorUnits, discountMinorUnits);

  const rule =
    input.explicitTaxMinorUnits === undefined
      ? await resolveApplicableTaxRule({
          businessId: input.businessId,
          countryCode: input.countryCode,
          stateCode: input.stateCode,
          category: input.category,
        })
      : null;

  let taxMinorUnits = 0;
  let taxMode: TaxCalculationMode = TaxCalculationMode.EXCLUSIVE;
  const components: TaxComponentBreakdown[] = [];

  if (input.explicitTaxMinorUnits !== undefined) {
    taxMinorUnits = assertValidMinorUnits(input.explicitTaxMinorUnits, "explicitTaxMinorUnits");
    if (taxMinorUnits > 0) {
      components.push({
        name: "TAX",
        rateBasisPoints: 0,
        amountMinorUnits: taxMinorUnits,
      });
    }
  } else if (rule) {
    taxMode = rule.mode;
    taxMinorUnits =
      rule.mode === TaxCalculationMode.INCLUSIVE
        ? computeInclusiveBasisPointsTax(taxableBaseMinorUnits, rule.rateBasisPoints)
        : computeBasisPointsAmount(taxableBaseMinorUnits, rule.rateBasisPoints);

    if (rule.components.length > 0 && rule.rateBasisPoints > 0) {
      let allocated = 0;
      rule.components.forEach((comp, idx) => {
        const amt =
          idx === rule.components.length - 1
            ? Math.max(0, taxMinorUnits - allocated)
            : Number(
                (BigInt(taxMinorUnits) * BigInt(comp.rateBasisPoints) +
                  BigInt(Math.floor(rule.rateBasisPoints / 2))) /
                  BigInt(rule.rateBasisPoints)
              );
        allocated += amt;
        components.push({
          name: comp.name,
          rateBasisPoints: comp.rateBasisPoints,
          amountMinorUnits: amt,
        });
      });
    } else if (taxMinorUnits > 0) {
      components.push({
        name: rule.name,
        rateBasisPoints: rule.rateBasisPoints,
        amountMinorUnits: taxMinorUnits,
      });
    }
  }

  const grandTotalMinorUnits =
    taxMode === TaxCalculationMode.INCLUSIVE
      ? addMinorUnits(addMinorUnits(taxableBaseMinorUnits, shippingMinorUnits), feesMinorUnits)
      : addMinorUnits(
          addMinorUnits(addMinorUnits(taxableBaseMinorUnits, taxMinorUnits), shippingMinorUnits),
          feesMinorUnits
        );

  return {
    version: "v1",
    calculatedAtUtc: new Date().toISOString(),
    currency,
    countryCode: input.countryCode ? normalizeCountryCode(input.countryCode) : null,
    stateCode: input.stateCode ? input.stateCode.trim().toUpperCase() : null,
    subtotalMinorUnits,
    discountMinorUnits,
    taxableBaseMinorUnits,
    shippingMinorUnits,
    feesMinorUnits,
    taxMinorUnits,
    grandTotalMinorUnits,
    taxRuleId: rule?.id ?? null,
    taxRuleName: rule?.name ?? null,
    taxMode,
    components,
  };
}

export function snapshotToOrderDecimals(snapshot: OrderTotalSnapshot) {
  return {
    subtotal: minorUnitsToDecimal(snapshot.subtotalMinorUnits, snapshot.currency),
    discount: minorUnitsToDecimal(snapshot.discountMinorUnits, snapshot.currency),
    tax: minorUnitsToDecimal(snapshot.taxMinorUnits, snapshot.currency),
    shipping: minorUnitsToDecimal(snapshot.shippingMinorUnits, snapshot.currency),
    totalAmount: minorUnitsToDecimal(snapshot.grandTotalMinorUnits, snapshot.currency),
    feesMinorUnits: snapshot.feesMinorUnits,
    totalSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    taxBreakdown: {
      taxRuleId: snapshot.taxRuleId,
      taxRuleName: snapshot.taxRuleName,
      taxMode: snapshot.taxMode,
      components: snapshot.components,
    } as unknown as Prisma.InputJsonValue,
  };
}
