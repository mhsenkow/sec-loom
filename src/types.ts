export type Action = "NEW" | "ADD" | "TRIM" | "EXIT" | "HOLD";
export type View = "grid" | "flow" | "map";
export type ThemeId = "night-grid" | "blacksite" | "solar-bloom" | "paper-terminal";
export type DataDelivery = "demo" | "snapshot" | "live";

export interface Security {
  id: string;
  /** Resolved ticker when available; null when unresolved. */
  ticker: string | null;
  issuer: string;
  sector: string;
  figi: string;
  holderCount: number;
  /** Aggregate net reported value change in millions USD; null when unknown. */
  netFlow: number | null;
  aggregateValue: number;
  insiderSignal?: boolean;
  hasConsensus?: boolean;
}

export interface Manager {
  cik: string;
  name: string;
  shortName: string;
  aum: number;
  coverage: number | null;
  status: string;
  brief: string;
  moveCount?: number;
}

export interface HoldingDiff {
  managerCik: string;
  securityId: string;
  action: Action;
  value: number;
  previousValue: number;
  delta: number;
  shares: number;
  accession: string;
  filedAt: string;
  period?: string;
  isAmendment?: boolean;
}

export interface InsiderTrade {
  ticker: string | null;
  issuer: string;
  insider: string;
  role: string;
  value: number;
  date: string;
  accession: string;
}

export interface DashboardAggregates {
  actionMix: {
    NEW: number;
    ADD: number;
    TRIM: number;
    EXIT: number;
    HOLD: number;
    activeTotal: number;
  };
  coverage: {
    tickerPct: number;
    sectorPct: number;
    resolutionPct: number;
  };
  totals: {
    diffCount: number;
    consensusCount: number;
    managerCount: number;
    insiderCount: number;
  };
}
