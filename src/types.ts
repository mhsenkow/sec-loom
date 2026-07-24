export type Action = "NEW" | "ADD" | "TRIM" | "EXIT" | "HOLD";
export type View = "grid" | "flow" | "map";
export type ThemeId = "night-grid" | "blacksite" | "solar-bloom" | "paper-terminal";

export interface Security {
  id: string;
  ticker: string;
  issuer: string;
  sector: string;
  figi: string;
  holderCount: number;
  netFlow: number;
  aggregateValue: number;
  insiderSignal?: boolean;
}

export interface Manager {
  cik: string;
  name: string;
  shortName: string;
  aum: number;
  coverage: number;
  status: string;
  brief: string;
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
  isAmendment?: boolean;
}

export interface InsiderTrade {
  ticker: string;
  insider: string;
  role: string;
  value: number;
  date: string;
  accession: string;
}
