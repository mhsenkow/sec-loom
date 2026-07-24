/** Values passed to formatMoney are in millions of USD unless noted. */

export function formatMoney(value: number, precise = false) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}T`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(precise ? 2 : 1)}B`;
  if (absolute >= 1) return `${sign}$${absolute.toFixed(precise ? 1 : 0)}M`;
  if (absolute >= 0.001) return `${sign}$${(absolute * 1_000).toFixed(0)}K`;
  return `${sign}$${(absolute * 1_000_000).toFixed(0)}`;
}

/** Format raw USD amounts (not millions). */
export function formatUsd(value: number, precise = false) {
  return formatMoney(value / 1_000_000, precise);
}

export function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

export function quarterLabel(date: string) {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return "Unavailable";
  const quarter = Math.floor(value.getUTCMonth() / 3) + 1;
  return `Q${quarter} ${value.getUTCFullYear()}`;
}

export function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

export function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function shortenName(name: string) {
  return name
    .replace(/\b(Management|Advisors?|Associates|Capital|Investments?|LLC|LP|Inc\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

export function issuerLabel(name: string, max = 18) {
  const cleaned = name
    .replace(/\b(inc|corp|corporation|company|co|plc|ltd|class|com|common|del)\b/gi, "")
    .replace(/[^a-z0-9 &.-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Unresolved";
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export function securityDisplay(security: {
  ticker: string | null;
  issuer: string;
}) {
  return security.ticker?.trim() || issuerLabel(security.issuer, 14);
}
