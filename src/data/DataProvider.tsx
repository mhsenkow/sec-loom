import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  DataContext,
  fallbackData,
  type DataContextValue,
  type Freshness,
} from "./DataContext";
import type { Action, HoldingDiff, InsiderTrade, Manager, Security } from "../types";

export function DataProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<DataContextValue>(fallbackData);

  const refresh = useCallback(async () => {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
    try {
      const response = await fetch(`${apiBase}/api/dashboard`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const payload = await response.json() as {
        data?: {
          managers?: RawManager[];
          diffs?: RawDiff[];
          consensus?: RawConsensus[];
          insiders?: RawInsider[];
        };
        meta?: {
          data_status?: string;
          freshness?: Freshness[];
          as_of?: string;
        };
      };
      if (payload.meta?.data_status !== "live" || !payload.data) return;
      setValue(mapLivePayload(payload.data, payload.meta.freshness ?? [], payload.meta.as_of));
    } catch {
      // The product proof remains explicitly labeled as demonstration data.
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 300_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const contextValue = useMemo(() => value, [value]);
  return <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>;
}

interface RawManager {
  cik: string;
  name: string;
  latest_13f_period: string;
  latest_13f_filed_at: string;
  latest_reported_value_usd: string;
}

interface RawDiff {
  cik: string;
  manager_name: string;
  security_id: string;
  ticker: string | null;
  issuer_name: string;
  sector: string | null;
  figi: string | null;
  action: string;
  value_curr: string;
  value_prev: string;
  delta_value: string;
  shares_curr: string;
  shares_prev: string;
  delta_shares: string;
  pct_portfolio_curr: string | null;
  input_accessions: string[];
  period_curr: string;
}

interface RawConsensus {
  security_id: string;
  period: string;
  holder_count: number;
  net_flow_usd: string;
  aggregate_value_usd: string;
  insider_open_market_buy_count: number;
  ticker: string | null;
  issuer_name: string;
  sector: string | null;
  figi: string | null;
}

interface RawInsider {
  accession_number: string;
  insider_name: string;
  role: string | null;
  value_usd: string | null;
  transaction_date: string;
  ticker: string | null;
  issuer_name: string;
}

function mapLivePayload(
  raw: {
    managers?: RawManager[];
    diffs?: RawDiff[];
    consensus?: RawConsensus[];
    insiders?: RawInsider[];
  },
  freshness: Freshness[],
  asOf?: string,
): DataContextValue {
  const rawDiffs = raw.diffs ?? [];
  const rawConsensus = raw.consensus ?? [];
  const rawInsiders = raw.insiders ?? [];
  const period = asOf ?? rawConsensus[0]?.period ?? rawDiffs[0]?.period_curr ?? "";
  const filingFreshness = freshness.find((item) => item.dataset === "13F");
  const filedAt = filingFreshness?.source_max_filed_at?.slice(0, 10) ?? period;
  const insiderTickers = new Set(rawInsiders.map((item) => item.ticker).filter(Boolean));

  const consensusBySecurity = new Map(
    rawConsensus.map((item) => [item.security_id, item]),
  );
  const diffBySecurity = new Map<string, RawDiff>();
  for (const item of rawDiffs) {
    if (!diffBySecurity.has(item.security_id)) diffBySecurity.set(item.security_id, item);
  }
  const securityIds = [
    ...new Set([
      ...rawDiffs.map((item) => item.security_id),
      ...rawConsensus.map((item) => item.security_id),
    ]),
  ];
  const securities: Security[] = securityIds.map((securityId) => {
    const consensus = consensusBySecurity.get(securityId);
    const diff = diffBySecurity.get(securityId);
    const ticker = consensus?.ticker ?? diff?.ticker ?? null;
    const issuer = consensus?.issuer_name ?? diff?.issuer_name ?? "Unresolved security";
    return {
      id: securityId,
      ticker: ticker ?? compactIssuer(issuer),
      issuer,
      sector: consensus?.sector ?? diff?.sector ?? "Unclassified",
      figi: consensus?.figi ?? diff?.figi ?? "Unresolved",
      holderCount: Number(consensus?.holder_count ?? 0),
      netFlow: toMillions(consensus?.net_flow_usd ?? diff?.delta_value ?? 0),
      aggregateValue: toMillions(consensus?.aggregate_value_usd ?? diff?.value_curr ?? 0),
      insiderSignal:
        Number(consensus?.insider_open_market_buy_count ?? 0) > 0 ||
        (ticker ? insiderTickers.has(ticker) : false),
    };
  });

  const holdingDiffs: HoldingDiff[] = rawDiffs
    .filter((item) => isAction(item.action))
    .map((item) => ({
      managerCik: item.cik,
      securityId: item.security_id,
      action: item.action as Action,
      value: toMillions(item.value_curr),
      previousValue: toMillions(item.value_prev),
      delta: toMillions(item.delta_value),
      shares: Number(item.shares_curr),
      accession: item.input_accessions?.at(-1) ?? "unavailable",
      filedAt,
    }));

  const managersByCik = new Map((raw.managers ?? []).map((item) => [item.cik, item]));
  const managerCiks = [
    ...new Set([
      ...rawDiffs.map((item) => item.cik),
      ...(raw.managers ?? []).map((item) => item.cik),
    ]),
  ];
  const managers: Manager[] = managerCiks.map((cik) => {
    const item = managersByCik.get(cik);
    const moves = holdingDiffs.filter((diff) => diff.managerCik === cik);
    const adds = moves.filter((diff) => diff.action === "ADD" || diff.action === "NEW").length;
    const trims = moves.filter((diff) => diff.action === "TRIM" || diff.action === "EXIT").length;
    return {
      cik,
      name: item?.name ?? rawDiffs.find((diff) => diff.cik === cik)?.manager_name ?? cik,
      shortName: shortenName(item?.name ?? rawDiffs.find((diff) => diff.cik === cik)?.manager_name ?? cik),
      aum: toMillions(item?.latest_reported_value_usd ?? 0),
      coverage: Number(filingFreshness?.coverage_pct ?? 0),
      status: `Filed ${item?.latest_13f_filed_at?.slice(0, 10) ?? filedAt}`,
      brief: `${adds} reported additions and ${trims} trims or exits in the latest complete quarter.`,
    };
  });

  const insiderTrades: InsiderTrade[] = rawInsiders.map((item) => ({
    ticker: item.ticker ?? "—",
    insider: item.insider_name,
    role: item.role ?? item.issuer_name,
    value: Number(item.value_usd ?? 0),
    date: formatShortDate(item.transaction_date),
    accession: item.accession_number,
  }));

  return {
    managers,
    securities,
    holdingDiffs,
    insiderTrades,
    periods: period ? [quarterLabel(period)] : [],
    freshness,
    isLive: true,
    dataLabel: "Live SEC ingestion",
    reportPeriod: period,
    lastRefreshed: filingFreshness?.last_ingested_at ?? null,
  };
}

function toMillions(value: string | number) {
  return Number(value) / 1_000_000;
}

function isAction(value: string): value is Action {
  return ["NEW", "ADD", "TRIM", "EXIT", "HOLD"].includes(value);
}

function quarterLabel(date: string) {
  const value = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const quarter = Math.floor(value.getUTCMonth() / 3) + 1;
  return `Q${quarter} ${value.getUTCFullYear()}`;
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: "UTC" })
    .format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

function shortenName(name: string) {
  return name
    .replace(/\b(Management|Advisors?|Associates|Capital|Investments?|LLC|LP|Inc\.?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

function compactIssuer(name: string) {
  const words = name
    .replace(/\b(inc|corp|corporation|company|co|plc|ltd|class|com|common)\b/gi, "")
    .replace(/[^a-z0-9 ]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "UNRES";
  if (words.length === 1) return words[0].slice(0, 8).toUpperCase();
  return words.slice(0, 4).map((word) => word[0]).join("").toUpperCase();
}
