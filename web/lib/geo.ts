import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Best-effort, zero-cost country detection — used for the leaderboard flag and similar
// country-specific display once someone has subscribed. NOT the source of truth: Stripe
// captures the real billing country during checkout (see the stripeWebhook function), and
// that's what gets saved as `countryCode` on the user's profile.

const TIMEZONE_COUNTRY: Record<string, string> = {
  // Australia
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "Australia/Adelaide": "AU",
  "Australia/Hobart": "AU",
  "Australia/Darwin": "AU",
  // United States
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Anchorage": "US",
  "Pacific/Honolulu": "US",
  "America/Phoenix": "US",
  // United Kingdom
  "Europe/London": "GB",
  // Eurozone
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Madrid": "ES",
  "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Dublin": "IE",
  "Europe/Lisbon": "PT",
  "Europe/Vienna": "AT",
  "Europe/Helsinki": "FI",
  "Europe/Athens": "GR",
  "Europe/Luxembourg": "LU",
  "Europe/Ljubljana": "SI",
  "Europe/Bratislava": "SK",
  "Europe/Tallinn": "EE",
  "Europe/Riga": "LV",
  "Europe/Vilnius": "LT",
  "Europe/Malta": "MT",
  // India
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  // Philippines
  "Asia/Manila": "PH",
};

export type PriceInfo = {
  currency: string;
  symbol: string;
  amount: number;
  display: string;
  annualAmount: number;
  annualDisplay: string;
  // True once these numbers came from today's live exchange rate (resolveLocalizedPricing)
  // rather than the static fallback table below — mirrors the mobile app's `isExact` flag on
  // its own DisplayPricing type, same purpose: gate whether to still show PRICE_CURRENCY_NOTE.
  isExact?: boolean;
};

const EUROZONE = new Set([
  "FR", "DE", "ES", "IT", "NL", "BE", "IE", "PT", "AT", "FI", "GR", "LU", "SI", "SK", "EE", "LV", "LT", "MT", "CY",
]);

// Which currency a country's price should be shown in. AUD is the real anchor (see below), so
// it's also the default for any country not listed here — that's an exact, not approximated,
// price, unlike every other currency in this map.
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD",
  AU: "AUD",
  GB: "GBP",
  IN: "INR",
  PH: "PHP",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  AUD: "A$",
  GBP: "£",
  INR: "₹",
  PHP: "₱",
  EUR: "€",
};

function currencyFor(countryCode: string | null): string {
  if (!countryCode) return "AUD";
  if (COUNTRY_CURRENCY[countryCode]) return COUNTRY_CURRENCY[countryCode];
  if (EUROZONE.has(countryCode)) return "EUR";
  return "AUD";
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${CURRENCY_SYMBOLS[currency] ?? ""}${amount.toFixed(2)}`;
  }
}

// AUD is the real anchor price Stripe charges against — A$4.99/week, A$199/year — because
// that's the only currency this Stripe account actually settles in (Adaptive Pricing requires
// the price's currency to be a settlement currency; see createCheckoutSession). Every other row
// here is a FALLBACK approximation shown only for the instant before resolveLocalizedPricing's
// live exchange rate loads (or if that fetch ever fails) — not a literal live FX rate, just a
// normal-looking local price so the very first paint isn't blank or USD-only. The real charge
// is always computed for real at checkout by Stripe's own Adaptive Pricing; see
// PRICE_CURRENCY_NOTE, which should be shown as a footnote wherever this is displayed.
const PRICING_BY_COUNTRY: Record<string, PriceInfo> = {
  AU: { currency: "AUD", symbol: "A$", amount: 4.99, display: "A$4.99/week", annualAmount: 199, annualDisplay: "A$199/year", isExact: true },
  US: { currency: "USD", symbol: "$", amount: 3.59, display: "$3.59/week", annualAmount: 143, annualDisplay: "$143/year" },
  GB: { currency: "GBP", symbol: "£", amount: 2.66, display: "£2.66/week", annualAmount: 106, annualDisplay: "£106/year" },
  IN: { currency: "INR", symbol: "₹", amount: 340, display: "₹340/week", annualAmount: 13540, annualDisplay: "₹13,540/year" },
  PH: { currency: "PHP", symbol: "₱", amount: 225, display: "₱225/week", annualAmount: 8954, annualDisplay: "₱8,954/year" },
};
const EUR_PRICE: PriceInfo = { currency: "EUR", symbol: "€", amount: 3.09, display: "€3.09/week", annualAmount: 123, annualDisplay: "€123/year" };
const DEFAULT_PRICE: PriceInfo = PRICING_BY_COUNTRY.AU;

// Shown as a footnote wherever a price from this file is displayed, so it's clear the figure is
// AUD-anchored and approximate for non-AU visitors rather than a locked-in local price.
export const PRICE_CURRENCY_NOTE =
  "Prices are set in AUD; local-currency amounts shown are estimates. Stripe will show your exact charge in your currency at checkout.";

export function detectCountryCode(): string | null {
  try {
    const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
    // Time zone first: it's a much more reliable signal for "where is this person" than
    // the browser/OS locale, which just reflects a language/region preference (e.g. a
    // UK-English macOS install used from Sydney reports locale "en-GB" but timeZone
    // "Australia/Sydney").
    if (TIMEZONE_COUNTRY[timeZone]) return TIMEZONE_COUNTRY[timeZone];
    const region = locale?.split("-")[1]?.toUpperCase();
    if (region && region.length === 2) return region;
    return null;
  } catch {
    return null;
  }
}

export function getLocalizedPricing(countryCode: string | null): PriceInfo {
  if (!countryCode) return DEFAULT_PRICE;
  if (PRICING_BY_COUNTRY[countryCode]) return PRICING_BY_COUNTRY[countryCode];
  if (EUROZONE.has(countryCode)) return EUR_PRICE;
  return DEFAULT_PRICE;
}

// Upgrades getLocalizedPricing's static fallback with today's real exchange rate, fetched from
// the config/exchangeRates doc that refreshExchangeRates (functions/index.js) keeps current once
// a day, unattended. AUD itself needs no conversion — it's the actual anchor, always exact.
// Falls back to the static table (with isExact left false/undefined) if the rates doc is
// missing or the fetch fails, so a Firestore hiccup degrades to "approximate" rather than
// breaking the price display entirely.
export async function resolveLocalizedPricing(countryCode: string | null): Promise<PriceInfo> {
  const currency = currencyFor(countryCode);
  if (currency === "AUD") return DEFAULT_PRICE;

  try {
    const snap = await getDoc(doc(db, "config", "exchangeRates"));
    const rate = snap.data()?.rates?.[currency];
    if (typeof rate !== "number") return getLocalizedPricing(countryCode);

    const amount = 4.99 * rate;
    const annualAmount = 199 * rate;
    return {
      currency,
      symbol: CURRENCY_SYMBOLS[currency] ?? "",
      amount,
      display: `${formatAmount(amount, currency)}/week`,
      annualAmount,
      annualDisplay: `${formatAmount(annualAmount, currency)}/year`,
      isExact: true,
    };
  } catch {
    return getLocalizedPricing(countryCode);
  }
}

// The annual plan's cost expressed per week, formatted the same way as the weekly display
// string above. Meant to be shown next to the weekly price struck through, so the saving reads
// at a glance: "~~$4.99/week~~ $3.83/week" rather than making someone compare two yearly totals.
export function annualWeeklyEquivalentDisplay(price: PriceInfo): string {
  const perWeek = price.annualAmount / 52;
  return `${price.symbol}${perWeek.toFixed(2)}/week`;
}

// Converts a 2-letter ISO-3166 country code into its flag emoji via Unicode regional
// indicator symbols (e.g. "AU" -> 🇦🇺). Returns "" for anything that isn't a clean 2-letter code.
export function flagEmoji(countryCode?: string | null): string {
  if (!countryCode || countryCode.length !== 2 || !/^[A-Za-z]{2}$/.test(countryCode)) return "";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
