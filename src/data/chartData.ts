import type { Action, HoldingDiff, Manager, Security } from "../types";
import { formatMoney, securityDisplay } from "../utils/format";
import { median, percentile } from "../utils/scales";

export interface ChartCoverage {
  tickerPct: number;
  sectorPct: number;
  insiderLinkedPct: number;
  sampleDiffs: number;
  sampleSecurities: number;
  sampleManagers: number;
}

export function coverageFrom(
  securities: Security[],
  holdingDiffs: HoldingDiff[],
  managers: Manager[],
): ChartCoverage {
  const withTicker = securities.filter((item) => item.ticker).length;
  const withSector = securities.filter(
    (item) => item.sector && item.sector !== "Unclassified",
  ).length;
  const withInsider = securities.filter((item) => item.insiderSignal).length;
  const denom = Math.max(securities.length, 1);
  return {
    tickerPct: (withTicker / denom) * 100,
    sectorPct: (withSector / denom) * 100,
    insiderLinkedPct: (withInsider / denom) * 100,
    sampleDiffs: holdingDiffs.length,
    sampleSecurities: securities.length,
    sampleManagers: managers.length,
  };
}

export function hasSectorCoverage(securities: Security[], threshold = 25) {
  return coverageFrom(securities, [], []).sectorPct >= threshold;
}

export function topMoves(
  holdingDiffs: HoldingDiff[],
  managers: Manager[],
  securities: Security[],
  limit = 8,
) {
  return [...holdingDiffs]
    .filter((diff) => diff.action !== "HOLD" && Math.abs(diff.delta) > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit)
    .map((diff) => {
      const manager = managers.find((item) => item.cik === diff.managerCik);
      const security = securities.find((item) => item.id === diff.securityId);
      return {
        ...diff,
        manager,
        security,
        label: security ? securityDisplay(security) : "Unresolved",
        managerLabel: manager?.shortName ?? diff.managerCik,
      };
    });
}

export function managerBreadthRows(
  managers: Manager[],
  holdingDiffs: HoldingDiff[],
  limit = 6,
) {
  return managers
    .map((manager) => {
      const diffs = holdingDiffs.filter((diff) => diff.managerCik === manager.cik);
      const adds = diffs.filter((diff) => diff.action === "NEW" || diff.action === "ADD").length;
      const cuts = diffs.filter((diff) => diff.action === "TRIM" || diff.action === "EXIT").length;
      return {
        ...manager,
        adds,
        cuts,
        breadth: adds - cuts,
        netDelta: diffs.reduce((sum, diff) => sum + diff.delta, 0),
        moveCount: diffs.filter((diff) => diff.action !== "HOLD").length,
      };
    })
    .filter((manager) => manager.moveCount > 0)
    .sort((a, b) => Math.abs(b.breadth) - Math.abs(a.breadth) || Math.abs(b.netDelta) - Math.abs(a.netDelta))
    .slice(0, limit);
}

export function sectorFlows(securities: Security[], limit = 7) {
  const totals = new Map<string, number>();
  for (const security of securities) {
    if (security.netFlow == null) continue;
    const sector = security.sector || "Unclassified";
    totals.set(sector, (totals.get(sector) ?? 0) + security.netFlow);
  }
  return [...totals.entries()]
    .map(([sector, netFlow]) => ({ sector, netFlow }))
    .sort((a, b) => Math.abs(b.netFlow) - Math.abs(a.netFlow))
    .slice(0, limit);
}

export function securityLeaders(securities: Security[], limit = 7) {
  return [...securities]
    .filter((security) => security.netFlow != null && security.netFlow !== 0)
    .sort((a, b) => Math.abs(b.netFlow ?? 0) - Math.abs(a.netFlow ?? 0))
    .slice(0, limit)
    .map((security) => ({
      ...security,
      label: securityDisplay(security),
    }));
}

export function actionMix(holdingDiffs: HoldingDiff[]) {
  const counts: Record<Action, number> = { NEW: 0, ADD: 0, TRIM: 0, EXIT: 0, HOLD: 0 };
  for (const diff of holdingDiffs) counts[diff.action] += 1;
  const activeTotal = counts.NEW + counts.ADD + counts.TRIM + counts.EXIT;
  const accumulation = counts.NEW + counts.ADD;
  const distribution = counts.TRIM + counts.EXIT;
  return {
    counts,
    total: holdingDiffs.length,
    activeTotal,
    accumulation,
    distribution,
    accumulationShare: activeTotal > 0 ? accumulation / activeTotal : 0,
  };
}

export function crowdingUniverse(securities: Security[], limit = 12) {
  return securities
    .filter((security) => security.holderCount > 0 && security.aggregateValue > 0)
    .sort((a, b) => b.aggregateValue - a.aggregateValue)
    .slice(0, limit);
}

export function concentrationRows(securities: Security[], limit = 5) {
  const universe = crowdingUniverse(securities, Math.max(limit, 12));
  const total = universe.reduce((sum, item) => sum + item.aggregateValue, 0);
  return universe.slice(0, limit).map((security, index) => ({
    ...security,
    label: securityDisplay(security),
    share: total > 0 ? security.aggregateValue / total : 0,
    rank: index + 1,
  }));
}

export function axisBreaks(values: number[]) {
  if (values.length === 0) {
    return { min: 0, max: 1, mid: 0, p10: 0, p90: 1 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min,
    max,
    mid: median(values),
    p10: percentile(values, 0.1),
    p90: percentile(values, 0.9),
  };
}

export function storySampleNote(coverage: ChartCoverage) {
  return `Based on the top ${coverage.sampleDiffs} reported moves and ${coverage.sampleSecurities} securities in the current dashboard sample.`;
}

export function deltaDirectionLabel(delta: number, action: Action) {
  if (delta > 0) return "Reported value up";
  if (delta < 0) return "Reported value down";
  return `${action} · value unchanged`;
}

export function summarizeNet(values: number[]) {
  const inflow = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const outflow = values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0);
  return {
    inflow,
    outflow,
    net: inflow + outflow,
    inflowLabel: formatMoney(inflow),
    outflowLabel: formatMoney(outflow),
  };
}
