// Best-effort, zero-cost country detection — used only to show an illustrative localized
// price before someone subscribes (e.g. "₹400/week" instead of a literal, too-low "₹5/week").
// It is NOT the source of truth for what anyone is actually charged: Stripe captures the
// real billing country during checkout (see the stripeWebhook function), and that's what
// gets saved as `countryCode` on the user's profile — the authoritative value used for the
// leaderboard flag and anything else once someone has subscribed. A wrong guess here just
// means the marketing page's illustrative price is off; Stripe's own Checkout page still
// shows and charges the correct localized amount.

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

const EUROZONE = new Set([
  "FR", "DE", "ES", "IT", "NL", "BE", "IE", "PT", "AT", "FI", "GR", "LU", "SI", "SK", "EE", "LV", "LT", "MT", "CY",
]);

export type PriceInfo = {
  currency: string;
  symbol: string;
  amount: number;
  display: string;
  // Illustrative annual price only (weekly amount * 50 — "2 weeks free" vs. paying weekly all
  // year). The actual amount charged is whatever the STRIPE_ANNUAL_PRICE_ID Price is configured
  // for in the dashboard — keep that set to match this multiplier per currency, or this display
  // number and the real charge will drift apart.
  annualAmount: number;
  annualDisplay: string;
};

// Sid's fixed weekly prices per market — deliberately NOT a literal FX conversion. Weak
// currencies (INR, PHP) are rounded well above the raw conversion of AU$5 so the price still
// reflects real value rather than reading as "basically free." Update this table (and the
// matching currency_options on the Stripe Price in the dashboard) together if prices change.
const PRICING_BY_COUNTRY: Record<string, PriceInfo> = {
  AU: { currency: "AUD", symbol: "AU$", amount: 5, display: "AU$5/week", annualAmount: 250, annualDisplay: "AU$250/year" },
  US: { currency: "USD", symbol: "$", amount: 5, display: "$5/week", annualAmount: 250, annualDisplay: "$250/year" },
  GB: { currency: "GBP", symbol: "£", amount: 5, display: "£5/week", annualAmount: 250, annualDisplay: "£250/year" },
  IN: { currency: "INR", symbol: "₹", amount: 400, display: "₹400/week", annualAmount: 20000, annualDisplay: "₹20,000/year" },
  PH: { currency: "PHP", symbol: "₱", amount: 250, display: "₱250/week", annualAmount: 12500, annualDisplay: "₱12,500/year" },
};
const EUR_PRICE: PriceInfo = { currency: "EUR", symbol: "€", amount: 5, display: "€5/week", annualAmount: 250, annualDisplay: "€250/year" };
const DEFAULT_PRICE: PriceInfo = { currency: "USD", symbol: "$", amount: 5, display: "$5/week", annualAmount: 250, annualDisplay: "$250/year" };

export function detectCountryCode(): string | null {
  try {
    const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
    // Time zone first: it's a much more reliable signal for "where is this person" than
    // the browser/OS locale, which just reflects a language/region preference (e.g. a
    // UK-English macOS install used from Sydney reports locale "en-GB" but timeZone
    // "Australia/Sydney" — we want AU pricing for that visitor, not GBP).
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
