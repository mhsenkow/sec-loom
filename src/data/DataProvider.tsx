import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  DataContext,
  fallbackData,
  type DataContextValue,
  type Freshness,
} from "./DataContext";
import { coverageFrom, storySampleNote } from "./chartData";
import { formatShortDate, quarterLabel, shortenName } from "../utils/format";
import type {
  Action,
  DashboardAggregates,
  DataDelivery,
  HoldingDiff,
  InsiderTrade,
  Manager,
  Security,
} from "../types";

export function DataProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<DataContextValue>(fallbackData);

  const refresh = useCallback(async () => {
    try {
      const payload = await loadDashboardPayload();
      if (!payload?.data || payload.meta?.data_status !== "live") return;
      setValue(
        mapLivePayload(
          payload.data,
          payload.meta.freshness ?? [],
          payload.meta.as_of,
          payload.meta.delivery === "static_snapshot" ? "snapshot" : "live",
          payload.data.aggregates ?? null,
        ),
      );
    } catch (error) {
      console.warn("dashboard_payload_mapping_failed", error);
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
  coverage_pct?: string | number | null;
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
  filed_at?: string | null;
  is_amendment?: boolean;
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
  issuer_cik?: string;
}

interface DashboardPayload {
  data?: {
    managers?: RawManager[];
    diffs?: RawDiff[];
    consensus?: RawConsensus[];
    insiders?: RawInsider[];
    aggregates?: DashboardAggregates;
  };
  meta?: {
    data_status?: string;
    freshness?: Freshness[];
    as_of?: string;
    delivery?: string;
  };
}

async function loadDashboardPayload(): Promise<DashboardPayload | null> {
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
  const candidates = [
    `${apiBase}/api/dashboard`,
    `${import.meta.env.BASE_URL}dashboard.json`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      const payload = await response.json() as DashboardPayload;
      if (payload.meta?.data_status === "live" && payload.data) return payload;
    } catch {
      // Try the next source; mock data remains the final fallback.
    }
  }
  return null;
}

function mapLivePayload(
  raw: {
    managers?: RawManager[];
    diffs?: RawDiff[];
    consensus?: RawConsensus[];
    insiders?: RawInsider[];
    aggregates?: DashboardAggregates;
  },
  freshness: Freshness[],
  asOf: string | undefined,
  delivery: Exclude<DataDelivery, "demo">,
  aggregates: DashboardAggregates | null,
): DataContextValue {
  const rawDiffs = raw.diffs ?? [];
  const rawConsensus = raw.consensus ?? [];
  const rawInsiders = raw.insiders ?? [];
  const period = asOf ?? rawConsensus[0]?.period ?? rawDiffs[0]?.period_curr ?? "";
  const filingFreshness = freshness.find((item) => item.dataset === "13F");
  const filedAt = filingFreshness?.source_max_filed_at?.slice(0, 10) ?? period.slice(0, 10);
  const insiderTickers = new Set(
    rawInsiders.map((item) => item.ticker).filter((ticker): ticker is string => Boolean(ticker)),
  );

  const consensusBySecurity = new Map(
    rawConsensus.map((item) => [item.security_id, item]),
  );
  const securityIds = [
    ...new Set([
      ...rawDiffs.map((item) => item.security_id),
      ...rawConsensus.map((item) => item.security_id),
    ]),
  ];

  const securities: Security[] = securityIds.map((securityId) => {
    const consensus = consensusBySecurity.get(securityId);
    const relatedDiffs = rawDiffs.filter((item) => item.security_id === securityId);
    const diff = relatedDiffs[0];
    const ticker = consensus?.ticker ?? diff?.ticker ?? null;
    const issuer = consensus?.issuer_name ?? diff?.issuer_name ?? "Unresolved security";
    const hasConsensus = Boolean(consensus);
    return {
      id: securityId,
      ticker,
      issuer,
      sector: consensus?.sector ?? diff?.sector ?? "Unclassified",
      figi: consensus?.figi ?? diff?.figi ?? "Unresolved",
      holderCount: Number(consensus?.holder_count ?? 0),
      netFlow: hasConsensus ? toMillions(consensus?.net_flow_usd ?? 0) : null,
      aggregateValue: toMillions(
        consensus?.aggregate_value_usd ?? diff?.value_curr ?? 0,
      ),
      insiderSignal:
        Number(consensus?.insider_open_market_buy_count ?? 0) > 0 ||
        (ticker ? insiderTickers.has(ticker) : false),
      hasConsensus,
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
      filedAt: item.filed_at?.slice(0, 10) ?? filedAt,
      period: item.period_curr?.slice(0, 10) ?? period.slice(0, 10),
      isAmendment: Boolean(item.is_amendment),
    }));

  const managersByCik = new Map((raw.managers ?? []).map((item) => [item.cik, item]));
  const activeManagerCiks = [...new Set(rawDiffs.map((item) => item.cik))];
  const managers: Manager[] = activeManagerCiks.map((cik) => {
    const item = managersByCik.get(cik);
    const moves = holdingDiffs.filter((diff) => diff.managerCik === cik);
    const adds = moves.filter((diff) => diff.action === "ADD" || diff.action === "NEW").length;
    const trims = moves.filter((diff) => diff.action === "TRIM" || diff.action === "EXIT").length;
    const name = item?.name ?? rawDiffs.find((diff) => diff.cik === cik)?.manager_name ?? cik;
    return {
      cik,
      name,
      shortName: shortenName(name),
      aum: toMillions(item?.latest_reported_value_usd ?? 0),
      coverage:
        item?.coverage_pct == null
          ? null
          : Number(item.coverage_pct),
      status: `Filed ${item?.latest_13f_filed_at?.slice(0, 10) ?? filedAt}`,
      brief: `${adds} reported additions and ${trims} trims or exits in the latest complete quarter.`,
      moveCount: moves.filter((diff) => diff.action !== "HOLD").length,
    };
  }).sort((a, b) => (b.moveCount ?? 0) - (a.moveCount ?? 0) || b.aum - a.aum);

  const insiderTrades: InsiderTrade[] = rawInsiders.map((item) => ({
    ticker: item.ticker,
    issuer: item.issuer_name,
    insider: item.insider_name,
    role: item.role ?? item.issuer_name,
    value: Number(item.value_usd ?? 0),
    date: formatShortDate(item.transaction_date),
    accession: item.accession_number,
  }));

  const coverage = coverageFrom(securities, holdingDiffs, managers);
  const resolutionPct = Number(filingFreshness?.coverage_pct ?? aggregates?.coverage.resolutionPct ?? 0);
  const derivedAggregates: DashboardAggregates = aggregates ?? {
    actionMix: {
      NEW: holdingDiffs.filter((d) => d.action === "NEW").length,
      ADD: holdingDiffs.filter((d) => d.action === "ADD").length,
      TRIM: holdingDiffs.filter((d) => d.action === "TRIM").length,
      EXIT: holdingDiffs.filter((d) => d.action === "EXIT").length,
      HOLD: holdingDiffs.filter((d) => d.action === "HOLD").length,
      activeTotal: holdingDiffs.filter((d) => d.action !== "HOLD").length,
    },
    coverage: {
      tickerPct: coverage.tickerPct,
      sectorPct: coverage.sectorPct,
      resolutionPct,
    },
    totals: {
      diffCount: holdingDiffs.length,
      consensusCount: rawConsensus.length,
      managerCount: managers.length,
      insiderCount: insiderTrades.length,
    },
  };

  return {
    managers,
    securities,
    holdingDiffs,
    insiderTrades,
    periods: period ? [quarterLabel(period)] : [],
    freshness,
    isLive: true,
    isContinuous: delivery === "live",
    delivery,
    dataLabel: delivery === "snapshot" ? "Synced SEC snapshot" : "Live SEC ingestion",
    reportPeriod: period.slice(0, 10),
    lastRefreshed: filingFreshness?.last_ingested_at ?? null,
    coveragePct: resolutionPct || null,
    aggregates: {
      ...derivedAggregates,
      coverage: {
        ...derivedAggregates.coverage,
        tickerPct: coverage.tickerPct,
        sectorPct: coverage.sectorPct,
      },
    },
    sampleNote: storySampleNote(coverage),
  };
}

function toMillions(value: string | number) {
  return Number(value) / 1_000_000;
}

function isAction(value: string): value is Action {
  return ["NEW", "ADD", "TRIM", "EXIT", "HOLD"].includes(value);
}
