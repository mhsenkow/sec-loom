import { createContext, useContext } from "react";
import {
  PERIODS as demoPeriods,
  holdingDiffs as demoDiffs,
  insiderTrades as demoInsiders,
  managers as demoManagers,
  securities as demoSecurities,
} from "./mockData";
import type {
  DashboardAggregates,
  DataDelivery,
  HoldingDiff,
  InsiderTrade,
  Manager,
  Security,
} from "../types";
import { coverageFrom } from "./chartData";

export interface Freshness {
  dataset: string;
  source_max_filed_at: string | null;
  period_of_report: string | null;
  last_ingested_at: string | null;
  record_count: string;
  coverage_pct: string | null;
  status: string;
}

export interface DataContextValue {
  managers: Manager[];
  securities: Security[];
  holdingDiffs: HoldingDiff[];
  insiderTrades: InsiderTrade[];
  periods: string[];
  freshness: Freshness[];
  isLive: boolean;
  isContinuous: boolean;
  delivery: DataDelivery;
  dataLabel: string;
  reportPeriod: string;
  lastRefreshed: string | null;
  coveragePct: number | null;
  aggregates: DashboardAggregates | null;
  sampleNote: string;
}

const demoCoverage = coverageFrom(demoSecurities, demoDiffs, demoManagers);

export const fallbackData: DataContextValue = {
  managers: demoManagers,
  securities: demoSecurities,
  holdingDiffs: demoDiffs,
  insiderTrades: demoInsiders,
  periods: demoPeriods,
  freshness: [],
  isLive: false,
  isContinuous: false,
  delivery: "demo",
  dataLabel: "Demonstration snapshot",
  reportPeriod: "2025-03-31",
  lastRefreshed: null,
  coveragePct: null,
  aggregates: {
    actionMix: {
      NEW: demoDiffs.filter((d) => d.action === "NEW").length,
      ADD: demoDiffs.filter((d) => d.action === "ADD").length,
      TRIM: demoDiffs.filter((d) => d.action === "TRIM").length,
      EXIT: demoDiffs.filter((d) => d.action === "EXIT").length,
      HOLD: demoDiffs.filter((d) => d.action === "HOLD").length,
      activeTotal: demoDiffs.filter((d) => d.action !== "HOLD").length,
    },
    coverage: {
      tickerPct: demoCoverage.tickerPct,
      sectorPct: demoCoverage.sectorPct,
      resolutionPct: 98.6,
    },
    totals: {
      diffCount: demoDiffs.length,
      consensusCount: demoSecurities.length,
      managerCount: demoManagers.length,
      insiderCount: demoInsiders.length,
    },
  },
  sampleNote: "Demonstration values for layout and interaction review.",
};

export const DataContext = createContext<DataContextValue>(fallbackData);

export function useData() {
  return useContext(DataContext);
}
