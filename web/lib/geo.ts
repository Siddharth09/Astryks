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
};

const EUROZONE = new Set([
  "FR", "DE", "ES", "IT", "NL", "BE", "IE", "PT", "AT", "FI", "GR", "LU", "SI", "SK", "EE", "LV", "LT", "MT", "CY",
]);

// USD is the anchor price everyone is actually charged against — $4.99/week, $199/year — and
// what's shown to a US visitor. Every other row here is an ILLUSTRATIVE approximation of what
// that converts to (rounded to a normal-looking local price, not a literal live FX rate), purely
// so a visitor in, say, Germany or India sees a number in their own currency instead of having
// to convert $4.99 in their head. The real charge is always computed for real at checkout —
// Stripe/Apple/Google apply the actual current rate — so this table only ever has to be roughly
// right, not exactly right; see PRICE_CURRENCY_NOTE, which should be shown as a footnote
// wherever this is displayed to make that clear.
const PRICING_BY_COUNTRY: Record<string, PriceInfo> = {
  US: { currency: "USD", symbol: "$", amount: 4.99, display: "$4.99/week", annualAmount: 199, annualDisplay: "$199/year" },
  AU: { currency: "AUD", symbol: "A$", amount: 4.99, display: "A$4.99/week", annualAmount: 199, annualDisplay: "A$199/year" },
  GB: { currency: "GBP", symbol: "£", amount: 4.99, display: "£4.99/week", annualAmount: 199, annualDisplay: "£199/year" },
  IN: { currency: "INR", symbol: "₹", amount: 399, display: "₹399/week", annualAmount: 15999, annualDisplay: "₹15,999/year" },
  PH: { currency: "PHP", symbol: "₱", amount: 249, display: "₱249/week", annualAmount: 9999, annualDisplay: "₱9,999/year" },
};
const EUR_PRICE: PriceInfo = { currency: "EUR", symbol: "€", amount: 4.99, display: "€4.99/week", annualAmount: 199, annualDisplay: "€199/year" };
const DEFAULT_PRICE: PriceInfo = PRICING_BY_COUNTRY.US;

// Shown as a footnote wherever a price from this file is displayed, so it's clear the figure is
// USD-anchored and approximate for non-US visitors rather than a locked-in local price.
export const PRICE_CURRENCY_NOTE =
  "Prices are set in USD; local-currency amounts shown are approximate. Stripe, Apple, or Google will show your exact charge in your currency at checkout.";

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
