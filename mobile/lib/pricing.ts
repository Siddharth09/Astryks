import { getRealProductPrices } from "./purchases";
import { annualWeeklyEquivalentDisplay, PriceInfo } from "./geo";

export type DisplayPricing = {
  weeklyDisplay: string;
  annualPerWeekDisplay: string;
  annualDisplay: string;
  // True once these are the real store-converted prices (matching what the native purchase
  // sheet will show) rather than lib/geo.ts's illustrative approximation — callers use this to
  // decide whether the "prices are approximate" footnote still applies.
  isExact: boolean;
};

function formatPerWeek(amount: number, currencyCode: string): string {
  try {
    return `${new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(amount)}/week`;
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}/week`;
  }
}

export function fallbackDisplayPricing(fallback: PriceInfo): DisplayPricing {
  return {
    weeklyDisplay: fallback.display,
    annualPerWeekDisplay: annualWeeklyEquivalentDisplay(fallback),
    annualDisplay: fallback.annualDisplay,
    isExact: false,
  };
}

// Tries the real store-converted prices first (see getRealProductPrices) and only falls back to
// the static approximate table if Qonversion hasn't loaded products yet (e.g. not signed in, or
// a network hiccup) — this is what keeps the pre-checkout screen from showing a different number
// than the native purchase sheet the user taps through to next.
export async function resolveDisplayPricing(fallback: PriceInfo): Promise<DisplayPricing> {
  const real = await getRealProductPrices();
  if (real.weekly && real.annual) {
    return {
      weeklyDisplay: `${real.weekly.pretty}/week`,
      annualPerWeekDisplay: formatPerWeek(real.annual.amount / 52, real.annual.currencyCode),
      annualDisplay: `${real.annual.pretty}/year`,
      isExact: true,
    };
  }
  return fallbackDisplayPricing(fallback);
}
