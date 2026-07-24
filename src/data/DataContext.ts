import { createContext, useContext } from "react";
import {
  PERIODS as demoPeriods,
  holdingDiffs as demoDiffs,
  insiderTrades as demoInsiders,
  managers as demoManagers,
  securities as demoSecurities,
} from "./mockData";
import type { HoldingDiff, InsiderTrade, Manager, Security } from "../types";

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
  dataLabel: string;
  reportPeriod: string;
  lastRefreshed: string | null;
}

export const fallbackData: DataContextValue = {
  managers: demoManagers,
  securities: demoSecurities,
  holdingDiffs: demoDiffs,
  insiderTrades: demoInsiders,
  periods: demoPeriods,
  freshness: [],
  isLive: false,
  dataLabel: "Demonstration snapshot",
  reportPeriod: "2025-03-31",
  lastRefreshed: null,
};

export const DataContext = createContext<DataContextValue>(fallbackData);

export function useData() {
  return useContext(DataContext);
}
