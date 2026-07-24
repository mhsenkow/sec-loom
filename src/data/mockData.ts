import type { HoldingDiff, InsiderTrade, Manager, Security } from "../types";

export const PERIODS = ["Q1 2025", "Q4 2024", "Q3 2024", "Q2 2024"];

export const managers: Manager[] = [
  {
    cik: "0001067983",
    name: "Berkshire Hathaway",
    shortName: "Berkshire",
    aum: 267_331,
    coverage: 99.8,
    status: "Filed · amended",
    brief:
      "Berkshire concentrated new capital in a defensive consumer name while continuing to trim its largest technology position.",
  },
  {
    cik: "0001350694",
    name: "Bridgewater Associates",
    shortName: "Bridgewater",
    aum: 21_839,
    coverage: 98.9,
    status: "Filed",
    brief:
      "Bridgewater broadened exposure across semiconductors and healthcare, with smaller exits funding the rotation.",
  },
  {
    cik: "0001649339",
    name: "Citadel Advisors",
    shortName: "Citadel",
    aum: 571_824,
    coverage: 97.6,
    status: "Filed",
    brief:
      "Citadel added to mega-cap technology while reducing selected financials; gross reported value increased.",
  },
  {
    cik: "0001037389",
    name: "Renaissance Technologies",
    shortName: "Renaissance",
    aum: 77_412,
    coverage: 99.4,
    status: "Filed",
    brief:
      "Renaissance showed measured accumulation in software and payments with no single position dominating flow.",
  },
  {
    cik: "0001336528",
    name: "Pershing Square Capital",
    shortName: "Pershing Sq.",
    aum: 14_836,
    coverage: 100,
    status: "Filed",
    brief:
      "Pershing Square's concentrated portfolio stayed quiet, with one meaningful trim and no reported exits.",
  },
  {
    cik: "0001167483",
    name: "Tiger Global Management",
    shortName: "Tiger Global",
    aum: 24_502,
    coverage: 96.8,
    status: "Filed",
    brief:
      "Tiger Global returned to growth exposure through two new positions while exiting a legacy commerce holding.",
  },
];

export const securities: Security[] = [
  { id: "aapl", ticker: "AAPL", issuer: "Apple Inc.", sector: "Technology", figi: "BBG000B9XRY4", holderCount: 18, netFlow: -3_860, aggregateValue: 31_400 },
  { id: "amzn", ticker: "AMZN", issuer: "Amazon.com Inc.", sector: "Consumer", figi: "BBG000BVPV84", holderCount: 15, netFlow: 2_920, aggregateValue: 22_700, insiderSignal: true },
  { id: "nvda", ticker: "NVDA", issuer: "NVIDIA Corp.", sector: "Technology", figi: "BBG000BBJQV0", holderCount: 19, netFlow: 6_480, aggregateValue: 28_900 },
  { id: "unh", ticker: "UNH", issuer: "UnitedHealth Group", sector: "Healthcare", figi: "BBG000CH5208", holderCount: 11, netFlow: 1_740, aggregateValue: 13_800, insiderSignal: true },
  { id: "v", ticker: "V", issuer: "Visa Inc.", sector: "Financials", figi: "BBG000PSKYX7", holderCount: 13, netFlow: 840, aggregateValue: 16_100 },
  { id: "oxy", ticker: "OXY", issuer: "Occidental Petroleum", sector: "Energy", figi: "BBG000BQZMH4", holderCount: 7, netFlow: -920, aggregateValue: 11_300 },
  { id: "googl", ticker: "GOOGL", issuer: "Alphabet Inc.", sector: "Communication", figi: "BBG009S39JX6", holderCount: 17, netFlow: 3_210, aggregateValue: 25_600 },
  { id: "cp", ticker: "CP", issuer: "Canadian Pacific Kansas City", sector: "Industrials", figi: "BBG000BT7ZK6", holderCount: 5, netFlow: -510, aggregateValue: 6_800 },
];

const accessions = [
  "0001193125-25-118742",
  "0001350694-25-000006",
  "0000950123-25-007934",
  "0001037389-25-000091",
  "0001172661-25-002640",
  "0000919574-25-003482",
];

const actions = [
  ["TRIM", "ADD", "ADD", "NEW", "HOLD", "EXIT", "ADD", "HOLD"],
  ["EXIT", "ADD", "NEW", "ADD", "TRIM", "HOLD", "ADD", "TRIM"],
  ["ADD", "NEW", "ADD", "TRIM", "EXIT", "ADD", "ADD", "TRIM"],
  ["TRIM", "ADD", "NEW", "HOLD", "ADD", "EXIT", "ADD", "NEW"],
  ["TRIM", "HOLD", "HOLD", "HOLD", "ADD", "TRIM", "HOLD", "HOLD"],
  ["EXIT", "NEW", "ADD", "TRIM", "NEW", "HOLD", "ADD", "EXIT"],
] as const;

export const holdingDiffs: HoldingDiff[] = managers.flatMap((manager, managerIndex) =>
  securities.map((security, securityIndex) => {
    const action = actions[managerIndex][securityIndex];
    const base = (8 - securityIndex) * (managerIndex === 2 ? 740 : 185) + managerIndex * 73;
    const direction = action === "TRIM" || action === "EXIT" ? -1 : action === "HOLD" ? 0 : 1;
    const delta = direction * Math.round(base * (0.18 + ((managerIndex + securityIndex) % 4) * 0.08));
    const value = action === "EXIT" ? 0 : base + delta;
    return {
      managerCik: manager.cik,
      securityId: security.id,
      action,
      value,
      previousValue: action === "NEW" ? 0 : Math.max(base, 0),
      delta,
      shares: Math.round((value * 1_000_000) / (80 + securityIndex * 31)),
      accession: accessions[managerIndex],
      filedAt: "2025-05-15",
      isAmendment: managerIndex === 0,
    };
  }),
);

export const insiderTrades: InsiderTrade[] = [
  { ticker: "AMZN", issuer: "Amazon.com Inc.", insider: "Douglas Herrington", role: "CEO, Worldwide Stores", value: 1_240_000, date: "May 09", accession: "0001018724-25-000071" },
  { ticker: "UNH", issuer: "UnitedHealth Group", insider: "Stephen Hemsley", role: "Board Chair", value: 5_020_000, date: "May 16", accession: "0000731766-25-000143" },
  { ticker: "V", issuer: "Visa Inc.", insider: "Teri List", role: "Director", value: 486_000, date: "May 12", accession: "0001403161-25-000056" },
];

export { formatMoney } from "../utils/format";
